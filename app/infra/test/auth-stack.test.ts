import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import { AuthStack } from '../lib/auth-stack.js';
import { CONFIG } from '../bin/main.js';

let auth: Template;

beforeAll(() => {
  const a = new App();
  const s = new AuthStack(a, 'Auth', {
    env: { account: CONFIG.account, region: CONFIG.region },
    domain: CONFIG.domain,
  });
  auth = Template.fromStack(s);
});

describe('user pool', () => {
  it('accepts a passkey as a way in, and demands the face rather than the unlock', () => {
    // `required` is the whole point: without it a passkey is satisfied by a
    // phone that happens to be unlocked, which is not what was asked for.
    auth.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: Match.objectLike({
        // CDK emits the factors in its own fixed order (password, emailOtp,
        // smsOtp, passkey), not the order they were listed in the props.
        SignInPolicy: { AllowedFirstAuthFactors: Match.arrayWith(['PASSWORD', 'EMAIL_OTP', 'WEB_AUTHN']) },
      }),
      WebAuthnUserVerification: 'required',
      // CloudFormation spells this with a capitalised trailing "ID", unlike
      // the CDK prop name `passkeyRelyingPartyId` that sets it.
      WebAuthnRelyingPartyID: CONFIG.domain,
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
});
