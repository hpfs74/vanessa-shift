import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import { AuthStack } from '../lib/auth-stack.js';

// Duplicated from `bin/main.ts` rather than imported: importing `CONFIG`
// from there instantiates the certificate and app stacks too, just to read
// one constant.
const CONFIG = {
  account: '495133941005',
  region: 'eu-south-1',
  domain: 'vanessa.matteo.cool',
  loginDomain: 'auth.vanessa.matteo.cool',
  zoneDomain: 'matteo.cool',
  zoneId: 'Z2T8X72UH7FONU',
};

let auth: Template;

beforeAll(() => {
  const a = new App();
  const s = new AuthStack(a, 'Auth', {
    env: { account: CONFIG.account, region: CONFIG.region },
    domain: CONFIG.domain,
    loginDomain: CONFIG.loginDomain,
    loginCertificateArn: 'arn:aws:acm:us-east-1:495133941005:certificate/finto-accesso',
    zoneDomain: CONFIG.zoneDomain,
    zoneId: CONFIG.zoneId,
  });
  auth = Template.fromStack(s);
});

/** True when `rpId` is one the *browser* will accept for a page served from
 *  `host`: WebAuthn allows the origin's own host, or any domain the host is
 *  a subdomain of (a "registrable suffix").
 *
 *  This is the looser of the two rules in play. Cognito additionally demands
 *  equality once the pool has a custom domain, so passing this is necessary
 *  and not sufficient — see the relying party id test below. */
function isRegistrableSuffix(rpId: string, host: string): boolean {
  return host === rpId || host.endsWith(`.${rpId}`);
}

describe('user pool', () => {
  it('accepts a passkey as a way in, and demands the face rather than the unlock', () => {
    // `required` is the whole point: without it a passkey is satisfied by a
    // phone that happens to be unlocked, which is not what was asked for.
    //
    // The relying party id is deliberately not asserted here. It used to be,
    // pinned to `CONFIG.domain`, and that made this test fail when the value
    // was corrected to the login hostname — a test that only had an opinion
    // because it was standing next to one. It has an owner now: see "the
    // passkey works at all" below.
    auth.hasResourceProperties('AWS::Cognito::UserPool', {
      WebAuthnUserVerification: 'required',
    });
  });

  it('has exactly these three ways in, and no others', () => {
    // arrayEquals, not arrayWith: a fourth factor added later (say
    // `smsOtp: true`) would open a new, weaker way into the account, and an
    // `arrayWith` check would keep passing right through it.
    auth.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: Match.objectLike({
        // CDK emits the factors in its own fixed order (password, emailOtp,
        // smsOtp, passkey), not the order they were listed in the props.
        SignInPolicy: { AllowedFirstAuthFactors: Match.arrayEquals(['PASSWORD', 'EMAIL_OTP', 'WEB_AUTHN']) },
      }),
    });
  });

  it('allows the passkey as a first factor, whatever order the others end up in', () => {
    // The one factor the feature is named after, checked on its own so a
    // future CDK reordering of the other two cannot take this down with it.
    auth.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: Match.objectLike({
        SignInPolicy: { AllowedFirstAuthFactors: Match.arrayWith(['WEB_AUTHN']) },
      }),
    });
  });

  it('demands a password long and varied enough to be the security floor', () => {
    // Without an explicit policy the pool falls back to Cognito's default
    // of eight characters — an invisible floor no line of this repo would
    // state or protect. The spec's advice ("generate it long and random,
    // keep it in a password manager") only holds if the pool enforces it.
    auth.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: Match.objectLike({
        PasswordPolicy: {
          MinimumLength: 32,
          RequireLowercase: true,
          RequireUppercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
          TemporaryPasswordValidityDays: 1,
        },
      }),
    });
  });

  it('does not offer self-service password recovery', () => {
    // The email OTP is already an allowed first factor, so a "forgot
    // password" flow gives an attacker with the inbox nothing new, while
    // adding a reset surface and a link the spec keeps off the login page.
    auth.hasResourceProperties('AWS::Cognito::UserPool', {
      AccountRecoverySetting: { RecoveryMechanisms: [{ Name: 'admin_only', Priority: 1 }] },
    });
  });

  it('is on the feature plan that has passkeys at all', () => {
    // Lite does not have them. This is the reason for the plan, not a taste.
    auth.hasResourceProperties('AWS::Cognito::UserPool', { UserPoolTier: 'ESSENTIALS' });
  });

  it('does not let anyone sign themselves up', () => {
    // One or two users, created by hand. An open pool on a public address is
    // an invitation.
    auth.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: Match.objectLike({ AllowAdminCreateUserOnly: true }),
    });
  });

  it('survives the stack being deleted', () => {
    // The users, their passkeys and their history are not re-creatable.
    auth.hasResource('AWS::Cognito::UserPool', { DeletionPolicy: 'Retain' });
  });

  it('gives the browser a client with no secret', () => {
    // A client secret inside a JavaScript bundle is not a secret. CDK
    // renders `generateSecret: false` as an explicit `false`, not an absent
    // key.
    auth.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AllowedOAuthFlows: ['code'],
      CallbackURLs: [`https://${CONFIG.domain}/`],
      LogoutURLs: [`https://${CONFIG.domain}/`],
    });
  });

  it('expires the session in a day, and the tokens sooner', () => {
    // A day is one Face ID in the morning. The natural OAuth behaviour is to
    // never ask again, which also means a lost phone stays in for months.
    // CDK always expresses token validity in minutes regardless of the unit
    // passed to `Duration`, so a day is 1440 here.
    auth.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      RefreshTokenValidity: 1440,
      TokenValidityUnits: Match.objectLike({ RefreshToken: 'minutes' }),
      AccessTokenValidity: 60,
      IdTokenValidity: 60,
    });
  });

  it('allows the sign-in flow the passkey needs', () => {
    // USER_AUTH is the choice-based flow; without it the passkey is
    // configured on the pool and unreachable from the client.
    auth.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_AUTH']),
    });
  });

  it('publishes the three outputs the next tasks are built on', () => {
    // Tasks 2 to 4 consume these by name. A rename or a drop here breaks a
    // later task with no signal until then, unless this asserts them.
    auth.hasOutput('IdPool', {});
    auth.hasOutput('IdClient', {});
    auth.hasOutput('DominioLogin', {});
  });
});

describe('login domain', () => {
  it('the passkey works at all: the relying party id is exactly the login domain', () => {
    // The assertion the whole custom domain exists for, and the one that
    // would have caught the pool shipping with managed login on
    // `turni-vanessa.auth.eu-south-1.amazoncognito.com`.
    //
    // Equality, not the registrable-suffix rule this used to assert. Two
    // rules bind the value and Cognito's is the narrower: with a custom
    // domain and managed login it demands "the fully-qualified domain name
    // of your custom domain". WebAuthn alone would also accept the apex
    // `vanessa.matteo.cool`, so a suffix check passes on a value Cognito
    // rejects — it tests the rule that is not in force.
    //
    // Read from the synthesized template, not from the props: what gets
    // deployed is what has to agree. CloudFormation spells the property with
    // a capitalised trailing "ID", unlike the CDK prop name
    // `passkeyRelyingPartyId` that sets it.
    const [pool] = Object.values(auth.findResources('AWS::Cognito::UserPool'));
    const [domain] = Object.values(auth.findResources('AWS::Cognito::UserPoolDomain'));
    const rpId: string = pool.Properties.WebAuthnRelyingPartyID;
    const host: string = domain.Properties.Domain;

    expect(rpId).toBe(host);

    // Why the pool has a custom domain at all, kept on the record: on the
    // prefix domain this replaced, the apex fails even the looser browser
    // rule, so the passkey was never offered.
    expect(
      isRegistrableSuffix('vanessa.matteo.cool', 'turni-vanessa.auth.eu-south-1.amazoncognito.com'),
    ).toBe(false);
    // And the value we do ship satisfies that looser rule too, trivially.
    expect(isRegistrableSuffix(rpId, host)).toBe(true);
  });

  it('is a custom domain, not a Cognito prefix domain', () => {
    // A prefix domain is spelt as a bare label with no `CustomDomainConfig`.
    // `Match.absent()` on that config is what tells the two apart, since a
    // partial match would pass on the domain name alone.
    auth.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      Domain: CONFIG.loginDomain,
      CustomDomainConfig: { CertificateArn: Match.anyValue() },
    });
  });

  it('presents the certificate issued for that hostname', () => {
    auth.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      CustomDomainConfig: {
        CertificateArn: 'arn:aws:acm:us-east-1:495133941005:certificate/finto-accesso',
      },
    });
  });

  it('runs managed login, not the classic hosted UI, or the passkey is not offered', () => {
    // Not a styling choice. AWS: "passkey sign-in isn't available in the
    // classic hosted UI", and the choice-based factors are "only available to
    // user pools with managed login domains". The CDK default is the classic
    // hosted UI (version 1), so leaving this off is the same defect as the
    // wrong domain: a login page that never offers the passkey.
    auth.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      ManagedLoginVersion: 2,
    });
  });

  it('has a branding style, without which managed login serves nothing at all', () => {
    // Cognito attaches a default style only to app clients created in the
    // console. This one is created by CloudFormation, which calls
    // `CreateUserPoolClient`: "managed login isn't available for an app client
    // created with an AWS SDK until you create one with a
    // CreateManagedLoginBranding request". So the style is a prerequisite for
    // the page existing, not a decoration on it.
    const styles = Object.values(auth.findResources('AWS::Cognito::ManagedLoginBranding'));
    expect(styles).toHaveLength(1);
    const [style] = styles;
    expect(style.Properties.UseCognitoProvidedValues).toBe(true);
    // Cognito's own values, so `Settings` and `Assets` must be absent — the
    // API rejects the combination.
    expect(style.Properties.Settings).toBeUndefined();
    expect(style.Properties.Assets).toBeUndefined();
    // Tied to our client, not to some other one: a style bound elsewhere
    // leaves this client exactly as unserved as no style at all.
    const [clientLogicalId] = Object.keys(auth.findResources('AWS::Cognito::UserPoolClient'));
    expect(style.Properties.ClientId).toEqual({ Ref: clientLogicalId });
  });

  it('points DNS at the pool domain, which Cognito does not do for us', () => {
    // Cognito serves a custom domain from a CloudFront distribution of its
    // own and leaves the record to us: without it the hostname resolves to
    // nothing and there is no login page to reach.
    const records = Object.values(auth.findResources('AWS::Route53::RecordSet'));
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record.Properties.Name).toBe(`${CONFIG.loginDomain}.`);
    expect(record.Properties.Type).toBe('A');
    expect(record.Properties.HostedZoneId).toBe(CONFIG.zoneId);
    // An alias onto the pool domain's own CloudFront endpoint, not an
    // address typed in by hand: that endpoint is not knowable before the
    // deploy. CDK reads it back with a small custom resource, so the chain
    // is record -> lookup -> domain, and all three links are asserted.
    const [lookupId, attribute] = record.Properties.AliasTarget.DNSName['Fn::GetAtt'];
    expect(attribute).toBe('DomainDescription.CloudFrontDistribution');
    const lookup = auth.findResources('Custom::UserPoolCloudFrontDomainName')[lookupId];
    const [domainLogicalId] = Object.keys(auth.findResources('AWS::Cognito::UserPoolDomain'));
    expect(JSON.stringify(lookup.Properties.Create)).toContain(domainLogicalId);
  });
});
