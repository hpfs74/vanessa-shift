/** Lo stack principale: tabella, Lambda, API, hosting, DNS. */

import { join } from 'node:path';

import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
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

export interface StackAppProps extends StackProps {
  readonly dominio: string;
  readonly zonaDominio: string;
  readonly zonaId: string;
  readonly certificatoArn: string;
  /** Cartella con il build del frontend. Assente al primo giro. */
  readonly cartellaWeb?: string;
}

// La radice del monorepo: le Lambda vivono in app/api, fuori da app/infra.
const RADICE_APP = join(import.meta.dirname, '..', '..');
const HANDLERS = join(RADICE_APP, 'api', 'src', 'handlers.ts');
const LOCK_API = join(RADICE_APP, 'package-lock.json');

export class StackApp extends Stack {
  readonly urlApi: string;

  constructor(scope: Construct, id: string, props: StackAppProps) {
    super(scope, id, { ...props, crossRegionReferences: true });

    // --- Dati ---
    // Point-in-time recovery e' la sola rete di sicurezza che resta, visto
    // che l'API e' aperta: permette di tornare indietro dopo un danno.
    const tabella = new TableV2(this, 'Tabella', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billing: Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // --- Lambda ---
    const lambda = (nome: string, handler: string) =>
      new NodejsFunction(this, nome, {
        entry: HANDLERS,
        handler,
        projectRoot: RADICE_APP,
        depsLockFilePath: LOCK_API,
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 256,
        timeout: Duration.seconds(10),
        logGroup: new LogGroup(this, `${nome}Log`, {
          retention: RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        environment: {
          TABELLA: tabella.tableName,
          ORIGINE_CONSENTITA: `https://${props.dominio}`,
        },
        bundling: { format: undefined, minify: true, sourceMap: true },
      });

    const fnGetShifts = lambda('GetShifts', 'getShifts');
    const fnPutShift = lambda('PutShift', 'putShift');
    const fnGetConfig = lambda('GetConfig', 'getConfig');
    const fnPutConfig = lambda('PutConfig', 'putConfig');

    // Permessi minimi: chi legge non scrive.
    tabella.grantReadData(fnGetShifts);
    tabella.grantReadData(fnGetConfig);
    tabella.grantReadWriteData(fnPutShift);
    tabella.grantReadWriteData(fnPutConfig);

    // --- API ---
    const api = new HttpApi(this, 'Api', {
      corsPreflight: {
        allowOrigins: [`https://${props.dominio}`],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.PUT, CorsHttpMethod.OPTIONS],
        allowHeaders: ['content-type'],
        maxAge: Duration.hours(1),
      },
    });

    const rotta = (path: string, metodo: HttpMethod, fn: NodejsFunction, nome: string) =>
      api.addRoutes({
        path,
        methods: [metodo],
        integration: new HttpLambdaIntegration(nome, fn),
      });

    rotta('/shifts', HttpMethod.GET, fnGetShifts, 'IntGetShifts');
    rotta('/shifts/{date}', HttpMethod.PUT, fnPutShift, 'IntPutShift');
    rotta('/config', HttpMethod.GET, fnGetConfig, 'IntGetConfig');
    rotta('/config', HttpMethod.PUT, fnPutConfig, 'IntPutConfig');

    // Senza autenticazione il throttling e' l'unico freno al traffico di terzi.
    api.defaultStage!.node.addDependency(tabella);
    const stage = api.defaultStage!.node.defaultChild as import('aws-cdk-lib/aws-apigatewayv2').CfnStage;
    stage.defaultRouteSettings = { throttlingRateLimit: 100, throttlingBurstLimit: 200 };

    this.urlApi = api.apiEndpoint;

    // --- Hosting ---
    const bucket = new Bucket(this, 'Sito', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribuzione = new Distribution(this, 'Distribuzione', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
      },
      domainNames: [props.dominio],
      certificate: Certificate.fromCertificateArn(this, 'Cert', props.certificatoArn),
      defaultRootObject: 'index.html',
      httpVersion: HttpVersion.HTTP2_AND_3,
      priceClass: PriceClass.PRICE_CLASS_100,
      // React Router serve le sue rotte dal client: un 404 dell'origine
      // non e' una pagina mancante, e' un percorso dell'app.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    if (props.cartellaWeb) {
      new BucketDeployment(this, 'DeploySito', {
        sources: [Source.asset(props.cartellaWeb)],
        destinationBucket: bucket,
        distribution: distribuzione,
        distributionPaths: ['/*'],
      });
    }

    const zona = HostedZone.fromHostedZoneAttributes(this, 'Zona', {
      hostedZoneId: props.zonaId,
      zoneName: props.zonaDominio,
    });

    new ARecord(this, 'RecordA', {
      zone: zona,
      recordName: props.dominio,
      target: RecordTarget.fromAlias(new CloudFrontTarget(distribuzione)),
    });

    new CfnOutput(this, 'UrlApi', { value: api.apiEndpoint });
    new CfnOutput(this, 'UrlSito', { value: `https://${props.dominio}` });
    new CfnOutput(this, 'NomeTabella', { value: tabella.tableName });
    new CfnOutput(this, 'BucketSito', { value: bucket.bucketName });
    new CfnOutput(this, 'IdDistribuzione', { value: distribuzione.distributionId });
  }
}
