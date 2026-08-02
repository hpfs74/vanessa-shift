/** The main stack: table, Lambdas, API, hosting, DNS.
 *
 * CONSTRUCT IDS STAY IN ITALIAN ON PURPOSE. A CDK construct id is part of the
 * CloudFormation logical id: renaming one destroys the resource and creates a
 * replacement. That would mean a new certificate, a new distribution, and an
 * orphaned DynamoDB table (it is RETAIN). The ids are not code style, they are
 * identity — only the surrounding code is translated.
 */

import { join } from 'node:path';

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { HttpApi, HttpMethod, CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  HttpVersion,
  PriceClass,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { AttributeType, Billing, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
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
        },
        bundling: { format: undefined, minify: true, sourceMap: true },
      });

    const getShiftsFn = lambda('GetShifts', 'getShifts');
    const putShiftFn = lambda('PutShift', 'putShift');
    const getConfigFn = lambda('GetConfig', 'getConfig');
    const putConfigFn = lambda('PutConfig', 'putConfig');

    // Least privilege: readers do not write.
    table.grantReadData(getShiftsFn);
    table.grantReadData(getConfigFn);
    table.grantReadWriteData(putShiftFn);
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

    route('/shifts', HttpMethod.GET, getShiftsFn, 'IntGetShifts');
    route('/shifts/{date}', HttpMethod.PUT, putShiftFn, 'IntPutShift');
    route('/config', HttpMethod.GET, getConfigFn, 'IntGetConfig');
    route('/config', HttpMethod.PUT, putConfigFn, 'IntPutConfig');

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
    new CfnOutput(this, 'UrlSito', { value: `https://${props.domain}` });
    new CfnOutput(this, 'NomeTabella', { value: table.tableName });
    new CfnOutput(this, 'BucketSito', { value: bucket.bucketName });
    new CfnOutput(this, 'IdDistribuzione', { value: distribution.distributionId });
  }
}
