import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, it } from 'vitest';

import { AuthStack } from '../lib/auth-stack.js';

// Duplicated from `bin/main.ts` rather than imported: importing `CONFIG`
// from there instantiates the certificate and app stacks too, just to read
// one constant.
const CONFIG = {
  account: '495133941005',
  region: 'eu-south-1',
  domain: 'vanessa.matteo.cool',
};

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
      WebAuthnUserVerification: 'required',
      // CloudFormation spells this with a capitalised trailing "ID", unlike
      // the CDK prop name `passkeyRelyingPartyId` that sets it.
      WebAuthnRelyingPartyID: CONFIG.domain,
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
