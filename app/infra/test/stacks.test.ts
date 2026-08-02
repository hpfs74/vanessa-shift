import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import { AppStack } from '../lib/app-stack.js';
import { CertificateStack } from '../lib/certificate-stack.js';

const CONFIG = {
  account: '495133941005',
  region: 'eu-south-1',
  domain: 'vanessa.matteo.cool',
  zoneDomain: 'matteo.cool',
  zoneId: 'Z2T8X72UH7FONU',
};

let app: Template;
let cert: Template;

beforeAll(() => {
  const a = new App();
  const sCert = new CertificateStack(a, 'Cert', {
    env: { account: CONFIG.account, region: 'us-east-1' },
    domain: CONFIG.domain,
    zoneDomain: CONFIG.zoneDomain,
    zoneId: CONFIG.zoneId,
  });
  const sApp = new AppStack(a, 'App', {
    env: { account: CONFIG.account, region: CONFIG.region },
    domain: CONFIG.domain,
    zoneDomain: CONFIG.zoneDomain,
    zoneId: CONFIG.zoneId,
    certificateArn: 'arn:aws:acm:us-east-1:495133941005:certificate/finto',
  });
  cert = Template.fromStack(sCert);
  app = Template.fromStack(sApp);
});

describe('certificate', () => {
  it('lives in us-east-1, as CloudFront demands', () => {
    const a = new App();
    const s = new CertificateStack(a, 'C', {
      env: { account: CONFIG.account, region: 'us-east-1' },
      domain: CONFIG.domain,
      zoneDomain: CONFIG.zoneDomain,
      zoneId: CONFIG.zoneId,
    });
    expect(s.region).toBe('us-east-1');
  });

  it('covers the app domain and validates over DNS', () => {
    cert.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: CONFIG.domain,
      ValidationMethod: 'DNS',
    });
  });
});

describe('table', () => {
  it('has point-in-time recovery enabled', () => {
    app.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      Replicas: Match.arrayWith([
        Match.objectLike({
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        }),
      ]),
    });
  });

  it('bills on demand, with no provisioned capacity', () => {
    app.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('survives deletion of the stack', () => {
    app.hasResource('AWS::DynamoDB::GlobalTable', { DeletionPolicy: 'Retain' });
  });

  it('has a composite pk/sk key', () => {
    app.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
    });
  });
});

describe('lambdas', () => {
  it('there is one per route', () => {
    const fn = app.findResources('AWS::Lambda::Function');
    const nostre = Object.values(fn).filter((f: any) =>
      ['getShifts', 'putShift', 'putShifts', 'getConfig', 'putConfig'].includes(
        f.Properties?.Handler?.split('.').pop(),
      ),
    );
    expect(nostre).toHaveLength(5);
  });

  it('run on Node 22 and ARM', () => {
    for (const f of Object.values(app.findResources('AWS::Lambda::Function')) as any[]) {
      if (!f.Properties?.Runtime?.startsWith('nodejs')) continue;
      if (f.Properties.Handler?.includes('index.handler')) continue; // CDK helper
      expect(f.Properties.Runtime).toBe('nodejs22.x');
      expect(f.Properties.Architectures).toEqual(['arm64']);
    }
  });

  it('know the table and the allowed origin', () => {
    app.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          ALLOWED_ORIGIN: `https://${CONFIG.domain}`,
          TABLE_NAME: Match.anyValue(),
        }),
      },
    });
  });

  it('read-only lambdas hold no write permissions', () => {
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
  it('exposes the five expected routes, under /api so CloudFront can forward the path as it is', () => {
    const rotte = Object.values(app.findResources('AWS::ApiGatewayV2::Route')).map(
      (r: any) => r.Properties.RouteKey,
    );
    expect(rotte).toEqual(
      expect.arrayContaining([
        'GET /api/shifts',
        'PUT /api/shifts',
        'PUT /api/shifts/{date}',
        'GET /api/config',
        'PUT /api/config',
      ]),
    );
  });

  it('limits CORS to the app origin alone', () => {
    app.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: [`https://${CONFIG.domain}`],
      }),
    });
  });

  it('sets throttling, the only brake given there is no authentication', () => {
    app.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: Match.objectLike({
        ThrottlingRateLimit: 100,
        ThrottlingBurstLimit: 200,
      }),
    });
  });

  it('has no authorizer: a deliberate choice, not an oversight', () => {
    expect(Object.keys(app.findResources('AWS::ApiGatewayV2::Authorizer'))).toHaveLength(0);
  });
});

describe('hosting', () => {
  it('the site bucket is not public', () => {
    app.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('the bucket is encrypted and demands TLS', () => {
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

  it('CloudFront reads the bucket through Origin Access Control', () => {
    // One, for the site bucket. The photo Function URL had a second one and no
    // longer does: OAC over a signed POST refused the request before the
    // function ran, so it was taken back out (see the comment in app-stack.ts).
    expect(
      Object.keys(app.findResources('AWS::CloudFront::OriginAccessControl')),
    ).toHaveLength(1);
  });

  it('serves the domain, forces HTTPS and sends 404s back to the app', () => {
    app.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: [CONFIG.domain],
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

  it('points DNS at the distribution', () => {
    app.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: `${CONFIG.domain}.`,
      Type: 'A',
      HostedZoneId: CONFIG.zoneId,
    });
  });
});

describe('reading photos', () => {
  it('has a Lambda with enough time for a reading', () => {
    app.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.readPhoto',
      Timeout: 120,
      ReservedConcurrentExecutions: 2,
    });
  });

  it('sits behind a Function URL, not behind API Gateway, closed to anything but CloudFront', () => {
    // `Cors` has to be gone, not merely unused. It is what stops a browser on
    // some other page from calling this URL directly, now that OAC is not
    // there to stop it outright. `hasResourceProperties` matches partially, so
    // without `Match.absent()` this passes with the block still attached.
    app.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'NONE', Cors: Match.absent() });
  });

  it('can invoke the model, and nothing else of Bedrock', () => {
    // Two resources, one statement: the `eu.` cross-region inference profile
    // that the call names, and the model in whichever region that profile
    // routes to. `bedrock-mantle` is deliberately absent — that namespace
    // belongs to the newer Messages endpoint, which serves nothing in
    // eu-south-1 (see the comment on MODEL in api/src/vision.ts).
    app.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'bedrock:InvokeModel',
            Effect: 'Allow',
            Resource: [
              `arn:aws:bedrock:${CONFIG.region}:${CONFIG.account}:inference-profile/eu.anthropic.claude-sonnet-4-6`,
              'arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-6',
            ],
          }),
        ]),
      }),
    });
  });

  it('the table expires the counter rows', () => {
    app.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TimeToLiveSpecification: { AttributeName: 'expires', Enabled: true },
    });
  });
});

describe('one door only', () => {
  it('routes the API under /api, so CloudFront can forward the path as it is', () => {
    for (const path of ['/api/shifts', '/api/shifts/{date}', '/api/config']) {
      app.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: Match.stringLikeRegexp(`^(GET|PUT) ${path.replace(/[{}]/g, '\\$&')}$`),
      });
    }
  });

  it('serves /api and /foto from the same distribution as the site', () => {
    app.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({ PathPattern: '/api/*' }),
          Match.objectLike({ PathPattern: '/foto/*' }),
        ]),
      }),
    });
  });

  it('caches neither of them: they are not pages', () => {
    const behaviours = app.findResources('AWS::CloudFront::Distribution');
    const config = Object.values(behaviours)[0].Properties.DistributionConfig;
    for (const b of config.CacheBehaviors) {
      // The managed CachingDisabled policy.
      expect(b.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
    }
  });

  it('does not forward Host, which both origins would refuse', () => {
    const behaviours = app.findResources('AWS::CloudFront::Distribution');
    const config = Object.values(behaviours)[0].Properties.DistributionConfig;
    for (const b of config.CacheBehaviors) {
      // Managed AllViewerExceptHostHeader.
      expect(b.OriginRequestPolicyId).toBe('b689b0a8-53d0-40ab-baf2-68738e2966ac');
    }
  });

  it('leaves the photo function open, deliberately, with the reason on record', () => {
    // AWS_IAM plus Origin Access Control was tried here and taken back out: a
    // signed POST was refused before the function ever ran, so nothing reached
    // our code and nothing said why. If someone puts it back, this test fails
    // and points them at the comment in app-stack.ts saying what was already
    // tried — rather than letting them rediscover it in production.
    app.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'NONE' });
    const cloudFrontInvoke = Object.values(
      app.findResources('AWS::Lambda::Permission'),
    ).filter((r) => r.Properties?.Principal === 'cloudfront.amazonaws.com');
    expect(cloudFrontInvoke).toHaveLength(0);
  });

  it('hands the API its shared secret as an origin header, never to the browser', () => {
    const behaviours = app.findResources('AWS::CloudFront::Distribution');
    const config = Object.values(behaviours)[0].Properties.DistributionConfig;
    const apiOrigin = config.Origins.find((o: { OriginPath?: string; Id: string }) =>
      config.CacheBehaviors.some(
        (b: { PathPattern: string; TargetOriginId: string }) =>
          b.PathPattern === '/api/*' && b.TargetOriginId === o.Id,
      ),
    );
    // Match.anyValue() is a CDK assertions matcher: it has no meaning to
    // vitest's own toEqual, which would compare against it structurally and
    // always fail. Assert the same fact — a header with this name, and some
    // value that isn't hardcoded to nothing — without that matcher.
    expect(apiOrigin.OriginCustomHeaders).toHaveLength(1);
    expect(apiOrigin.OriginCustomHeaders[0].HeaderName).toBe('x-cloudfront-origin');
    expect(apiOrigin.OriginCustomHeaders[0].HeaderValue).toBeTruthy();
  });
});
