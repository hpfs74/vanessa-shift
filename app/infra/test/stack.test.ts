import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import { StackApp } from '../lib/stack-app.js';
import { StackCertificato } from '../lib/stack-web.js';

const CONFIG = {
  account: '495133941005',
  regione: 'eu-south-1',
  dominio: 'vanessa.matteo.cool',
  zonaDominio: 'matteo.cool',
  zonaId: 'Z2T8X72UH7FONU',
};

let app: Template;
let cert: Template;

beforeAll(() => {
  const a = new App();
  const sCert = new StackCertificato(a, 'Cert', {
    env: { account: CONFIG.account, region: 'us-east-1' },
    dominio: CONFIG.dominio,
    zonaDominio: CONFIG.zonaDominio,
    zonaId: CONFIG.zonaId,
  });
  const sApp = new StackApp(a, 'App', {
    env: { account: CONFIG.account, region: CONFIG.regione },
    dominio: CONFIG.dominio,
    zonaDominio: CONFIG.zonaDominio,
    zonaId: CONFIG.zonaId,
    certificatoArn: 'arn:aws:acm:us-east-1:495133941005:certificate/finto',
  });
  cert = Template.fromStack(sCert);
  app = Template.fromStack(sApp);
});

describe('certificato', () => {
  it('sta in us-east-1, come CloudFront pretende', () => {
    const a = new App();
    const s = new StackCertificato(a, 'C', {
      env: { account: CONFIG.account, region: 'us-east-1' },
      dominio: CONFIG.dominio,
      zonaDominio: CONFIG.zonaDominio,
      zonaId: CONFIG.zonaId,
    });
    expect(s.region).toBe('us-east-1');
  });

  it('copre il dominio dellapp e si valida via DNS', () => {
    cert.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: CONFIG.dominio,
      ValidationMethod: 'DNS',
    });
  });
});

describe('tabella', () => {
  it('ha il point-in-time recovery attivo', () => {
    app.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      Replicas: Match.arrayWith([
        Match.objectLike({
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        }),
      ]),
    });
  });

  it('e a consumo, senza capacita prenotata', () => {
    app.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('sopravvive alla cancellazione dello stack', () => {
    app.hasResource('AWS::DynamoDB::GlobalTable', { DeletionPolicy: 'Retain' });
  });

  it('ha chiave composta pk/sk', () => {
    app.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
    });
  });
});

describe('lambda', () => {
  it('ce ne sono quattro, una per rotta', () => {
    const fn = app.findResources('AWS::Lambda::Function');
    const nostre = Object.values(fn).filter((f: any) =>
      ['getShifts', 'putShift', 'getConfig', 'putConfig'].includes(f.Properties?.Handler?.split('.').pop()),
    );
    expect(nostre).toHaveLength(4);
  });

  it('girano su Node 22 e ARM', () => {
    for (const f of Object.values(app.findResources('AWS::Lambda::Function')) as any[]) {
      if (!f.Properties?.Runtime?.startsWith('nodejs')) continue;
      if (f.Properties.Handler?.includes('index.handler')) continue; // helper CDK
      expect(f.Properties.Runtime).toBe('nodejs22.x');
      expect(f.Properties.Architectures).toEqual(['arm64']);
    }
  });

  it('conoscono la tabella e lorigine consentita', () => {
    app.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          ORIGINE_CONSENTITA: `https://${CONFIG.dominio}`,
          TABELLA: Match.anyValue(),
        }),
      },
    });
  });

  it('le lambda di sola lettura non hanno permessi di scrittura', () => {
    const policies = Object.values(app.findResources('AWS::IAM::Policy')) as any[];
    const lettura = policies.filter((p) => {
      const azioni = p.Properties.PolicyDocument.Statement.flatMap((s: any) =>
        Array.isArray(s.Action) ? s.Action : [s.Action],
      );
      return azioni.includes('dynamodb:GetItem') && !azioni.includes('dynamodb:PutItem');
    });
    expect(lettura.length).toBeGreaterThanOrEqual(2);
  });
});

describe('api', () => {
  it('espone le quattro rotte previste', () => {
    const rotte = Object.values(app.findResources('AWS::ApiGatewayV2::Route')).map(
      (r: any) => r.Properties.RouteKey,
    );
    expect(rotte).toEqual(
      expect.arrayContaining([
        'GET /shifts',
        'PUT /shifts/{date}',
        'GET /config',
        'PUT /config',
      ]),
    );
  });

  it('limita il CORS alla sola origine dellapp', () => {
    app.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: [`https://${CONFIG.dominio}`],
      }),
    });
  });

  it('ha il throttling impostato, unico freno visto che non ce autenticazione', () => {
    app.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: Match.objectLike({
        ThrottlingRateLimit: 100,
        ThrottlingBurstLimit: 200,
      }),
    });
  });

  it('non ha authorizer: e una scelta deliberata, non una dimenticanza', () => {
    expect(Object.keys(app.findResources('AWS::ApiGatewayV2::Authorizer'))).toHaveLength(0);
  });
});

describe('hosting', () => {
  it('il bucket del sito non e pubblico', () => {
    app.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('il bucket e cifrato e pretende TLS', () => {
    app.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: Match.objectLike({
        ServerSideEncryptionConfiguration: Match.anyValue(),
      }),
    });
    const policies = Object.values(app.findResources('AWS::S3::BucketPolicy')) as any[];
    const tls = policies.some((p) =>
      JSON.stringify(p.Properties.PolicyDocument).includes('aws:SecureTransport'),
    );
    expect(tls).toBe(true);
  });

  it('CloudFront legge il bucket con Origin Access Control', () => {
    expect(
      Object.keys(app.findResources('AWS::CloudFront::OriginAccessControl')),
    ).toHaveLength(1);
  });

  it('serve il dominio, forza HTTPS e rimanda i 404 allapp', () => {
    app.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: [CONFIG.dominio],
        DefaultRootObject: 'index.html',
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
        }),
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({
            ErrorCode: 404,
            ResponseCode: 200,
            ResponsePagePath: '/index.html',
          }),
        ]),
      }),
    });
  });

  it('punta il DNS alla distribuzione', () => {
    app.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: `${CONFIG.dominio}.`,
      Type: 'A',
      HostedZoneId: CONFIG.zonaId,
    });
  });
});
