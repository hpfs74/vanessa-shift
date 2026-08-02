/** The main stack: table, Lambdas, API, hosting, DNS.
 *
 * CONSTRUCT IDS STAY IN ITALIAN ON PURPOSE. A CDK construct id is part of the
 * CloudFormation logical id: renaming one destroys the resource and creates a
 * replacement. That would mean a new certificate, a new distribution, and an
 * orphaned DynamoDB table (it is RETAIN). The ids are not code style, they are
 * identity — only the surrounding code is translated.
 */

import { join } from 'node:path';

import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { HttpApi, HttpMethod, CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  HttpVersion,
  OriginRequestPolicy,
  PriceClass,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { AttributeType, Billing, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, FunctionUrlAuthType, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

export interface AppStackProps extends StackProps {
  readonly domain: string;
  readonly zoneDomain: string;
  readonly zoneId: string;
  readonly certificateArn: string;
  /** Folder holding the built frontend. Absent on the very first deploy. */
  readonly webDist?: string;
}

// The monorepo root: the Lambdas live in app/api, outside app/infra.
const APP_ROOT = join(import.meta.dirname, '..', '..');
const HANDLERS = join(APP_ROOT, 'api', 'src', 'handlers.ts');
const API_LOCKFILE = join(APP_ROOT, 'package-lock.json');

export class AppStack extends Stack {
  readonly apiUrl: string;
  readonly photoUrl: string;

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, { ...props, crossRegionReferences: true });

    // --- Data ---
    // Point-in-time recovery is the only safety net left, given the API is
    // open: it makes it possible to roll back after damage.
    const table = new TableV2(this, 'Tabella', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billing: Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      // Only the photo counter rows carry `expires`: shifts don't,
      // and they stay where they are.
      timeToLiveAttribute: 'expires',
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Shared with CloudFront so the API can tell a request that came through
    // the distribution from one aimed at its own hostname. RETAIN because a
    // regenerated value would refuse every request until both sides catch up.
    const originSecret = new Secret(this, 'SegretoOrigine', {
      generateSecretString: { passwordLength: 40, excludePunctuation: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // --- Lambdas ---
    const lambda = (constructId: string, handler: string) =>
      new NodejsFunction(this, constructId, {
        entry: HANDLERS,
        handler,
        projectRoot: APP_ROOT,
        depsLockFilePath: API_LOCKFILE,
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 256,
        timeout: Duration.seconds(10),
        logGroup: new LogGroup(this, `${constructId}Log`, {
          retention: RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        environment: {
          TABLE_NAME: table.tableName,
          ALLOWED_ORIGIN: `https://${props.domain}`,
          ORIGIN_SECRET: originSecret.secretValue.unsafeUnwrap(),
        },
        bundling: { format: undefined, minify: true, sourceMap: true },
      });

    const getShiftsFn = lambda('GetShifts', 'getShifts');
    const putShiftFn = lambda('PutShift', 'putShift');
    const putShiftsFn = lambda('PutShifts', 'putShifts');
    const getConfigFn = lambda('GetConfig', 'getConfig');
    const putConfigFn = lambda('PutConfig', 'putConfig');

    // A reading combines reasoning and vision: it can take more than the 30
    // seconds to which API Gateway truncates the integration. Hence the
    // Function URL, which doesn't have that limit. The other five routes are
    // untouched.
    const readPhotoFn = new NodejsFunction(this, 'ReadPhoto', {
      entry: HANDLERS,
      handler: 'readPhoto',
      projectRoot: APP_ROOT,
      depsLockFilePath: API_LOCKFILE,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(120),
      // Without API Gateway's throttling, this is the brake on parallelism.
      reservedConcurrentExecutions: 2,
      logGroup: new LogGroup(this, 'ReadPhotoLog', {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        TABLE_NAME: table.tableName,
        ALLOWED_ORIGIN: `https://${props.domain}`,
      },
      bundling: { format: undefined, minify: true, sourceMap: true },
    });

    // Writes only the quota counter, but there's only one table.
    table.grantReadWriteData(readPhotoFn);

    readPhotoFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-opus-5`],
      }),
    );

    // NONE, not AWS_IAM. Origin Access Control was tried and taken out again:
    // with OAC the function is invoked over SigV4, and a signed POST needs the
    // viewer to supply the body hash — which the frontend was made to do. It
    // still did not work: the request was refused before the function ran, so
    // nothing reached our code and nothing said why. Diagnosing that further
    // while the feature was down was not worth it.
    //
    // What is given up: this URL stays reachable by anyone who knows it. What
    // is kept: it is not reachable from a browser on another page, because the
    // CORS block is gone, and everything Vanessa uses goes through CloudFront.
    // The API's own origin is still closed — see the shared secret above.
    const photoFunctionUrl = readPhotoFn.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
    });
    this.photoUrl = photoFunctionUrl.url;

    // Least privilege: readers do not write.
    table.grantReadData(getShiftsFn);
    table.grantReadData(getConfigFn);
    table.grantReadWriteData(putShiftFn);
    table.grantReadWriteData(putShiftsFn);
    table.grantReadWriteData(putConfigFn);

    // --- API ---
    const api = new HttpApi(this, 'Api', {
      corsPreflight: {
        allowOrigins: [`https://${props.domain}`],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.PUT, CorsHttpMethod.OPTIONS],
        allowHeaders: ['content-type'],
        maxAge: Duration.hours(1),
      },
    });

    const route = (path: string, method: HttpMethod, fn: NodejsFunction, constructId: string) =>
      api.addRoutes({
        path,
        methods: [method],
        integration: new HttpLambdaIntegration(constructId, fn),
      });

    route('/api/shifts', HttpMethod.GET, getShiftsFn, 'IntGetShifts');
    route('/api/shifts', HttpMethod.PUT, putShiftsFn, 'IntPutShifts');
    route('/api/shifts/{date}', HttpMethod.PUT, putShiftFn, 'IntPutShift');
    route('/api/config', HttpMethod.GET, getConfigFn, 'IntGetConfig');
    route('/api/config', HttpMethod.PUT, putConfigFn, 'IntPutConfig');

    // With no authentication, throttling is the only brake on third-party traffic.
    api.defaultStage!.node.addDependency(table);
    const stage = api.defaultStage!.node
      .defaultChild as import('aws-cdk-lib/aws-apigatewayv2').CfnStage;
    stage.defaultRouteSettings = { throttlingRateLimit: 100, throttlingBurstLimit: 200 };

    this.apiUrl = api.apiEndpoint;

    // --- Hosting ---
    const bucket = new Bucket(this, 'Sito', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new Distribution(this, 'Distribuzione', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        // Neither of these is a page: no caching, every method, and Host left
        // behind — forwarding it makes both origins refuse the request.
        '/api/*': {
          origin: new HttpOrigin(Fn.select(2, Fn.split('/', api.apiEndpoint)), {
            customHeaders: { 'x-cloudfront-origin': originSecret.secretValue.unsafeUnwrap() },
          }),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: AllowedMethods.ALLOW_ALL,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        '/foto/*': {
          origin: new HttpOrigin(Fn.select(2, Fn.split('/', photoFunctionUrl.url)), {
            // CloudFront caps the origin at 60 seconds and will not go higher
            // without a quota increase. A reading should take 15 to 40; past
            // 60 the viewer gets a 504, which the app already shows as "the
            // service is not responding" with a way out.
            readTimeout: Duration.seconds(60),
          }),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: AllowedMethods.ALLOW_ALL,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      domainNames: [props.domain],
      certificate: Certificate.fromCertificateArn(this, 'Cert', props.certificateArn),
      defaultRootObject: 'index.html',
      httpVersion: HttpVersion.HTTP2_AND_3,
      priceClass: PriceClass.PRICE_CLASS_100,
      // The client router serves its own paths: a 404 from the origin is not
      // a missing page, it is a route belonging to the app.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    if (props.webDist) {
      new BucketDeployment(this, 'DeploySito', {
        sources: [Source.asset(props.webDist)],
        destinationBucket: bucket,
        distribution,
        distributionPaths: ['/*'],
      });
    }

    const zone = HostedZone.fromHostedZoneAttributes(this, 'Zona', {
      hostedZoneId: props.zoneId,
      zoneName: props.zoneDomain,
    });

    new ARecord(this, 'RecordA', {
      zone,
      recordName: props.domain,
      target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
    });

    new CfnOutput(this, 'UrlApi', { value: api.apiEndpoint });
    new CfnOutput(this, 'PhotoUrl', { value: photoFunctionUrl.url });
    new CfnOutput(this, 'UrlSito', { value: `https://${props.domain}` });
    new CfnOutput(this, 'NomeTabella', { value: table.tableName });
    new CfnOutput(this, 'BucketSito', { value: bucket.bucketName });
    new CfnOutput(this, 'IdDistribuzione', { value: distribution.distributionId });
  }
}
