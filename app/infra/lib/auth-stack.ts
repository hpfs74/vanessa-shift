/** Who gets in. A user pool, a passkey, and a login page.
 *
 * Its own stack because its lifetime is not the app's: the users, their
 * registered devices and their history cannot be re-created by a deploy, and a
 * stack that can be torn down and rebuilt must not be the one holding them.
 */

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AccountRecovery,
  FeaturePlan,
  OAuthScope,
  PasskeyUserVerification,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
} from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

export interface AuthStackProps extends StackProps {
  readonly domain: string;
}

export class AuthStack extends Stack {
  readonly userPoolId: string;
  readonly userPoolClientId: string;
  readonly loginDomain: string;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const pool = new UserPool(this, 'Utenti', {
      signInAliases: { email: true },
      // One or two people, created by hand. An open pool on a public address
      // is an invitation.
      selfSignUpEnabled: false,
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      // Passkeys do not exist on the Lite plan. This is the reason for the
      // plan, not a preference.
      featurePlan: FeaturePlan.ESSENTIALS,
      signInPolicy: {
        allowedFirstAuthFactors: {
          // `password` is not optional — Cognito's own API says "This must
          // be true". A password therefore always exists and always works:
          // the passkey is the pleasant route, not the only one. Generate it
          // long and random, and keep it in a password manager.
          password: true,
          // The bootstrap: a passkey cannot be registered on an account that
          // does not exist yet.
          emailOtp: true,
          passkey: true,
        },
      },
      passkeyRelyingPartyId: props.domain,
      // `required` is the whole point. Without it a passkey is satisfied by a
      // phone that happens to be unlocked, which is not what was asked for.
      passkeyUserVerification: PasskeyUserVerification.REQUIRED,
      // The users, their passkeys and their history are not re-creatable.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const client = new UserPoolClient(this, 'ClienteWeb', {
      userPool: pool,
      // No secret: one inside a JavaScript bundle is not a secret. The browser
      // uses authorization code with PKCE instead.
      generateSecret: false,
      authFlows: { user: true },
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL],
        callbackUrls: [`https://${props.domain}/`],
        logoutUrls: [`https://${props.domain}/`],
      },
      // A day, so she touches Face ID once in the morning. OAuth's natural
      // behaviour is to never ask again, which is more convenient and leaves a
      // lost phone signed in for months.
      refreshTokenValidity: Duration.days(1),
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
    });

    const login = pool.addDomain('DominioAccesso', {
      cognitoDomain: { domainPrefix: 'turni-vanessa' },
    });

    this.userPoolId = pool.userPoolId;
    this.userPoolClientId = client.userPoolClientId;
    this.loginDomain = login.baseUrl();

    new CfnOutput(this, 'IdPool', { value: pool.userPoolId });
    new CfnOutput(this, 'IdClient', { value: client.userPoolClientId });
    new CfnOutput(this, 'DominioLogin', { value: login.baseUrl() });
  }
}
