/** Who gets in. A user pool, a passkey, and a login page.
 *
 * Its own stack because its lifetime is not the app's: the users, their
 * registered devices and their history cannot be re-created by a deploy, and a
 * stack that can be torn down and rebuilt must not be the one holding them.
 */

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  AccountRecovery,
  CfnManagedLoginBranding,
  FeaturePlan,
  ManagedLoginVersion,
  OAuthScope,
  PasskeyUserVerification,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
} from 'aws-cdk-lib/aws-cognito';
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { UserPoolDomainTarget } from 'aws-cdk-lib/aws-route53-targets';
import type { Construct } from 'constructs';

export interface AuthStackProps extends StackProps {
  readonly domain: string;
  /** Hostname of the managed login page, and — not by coincidence — the
   *  passkey relying party id. See `passkeyRelyingPartyId` below. */
  readonly loginDomain: string;
  /** us-east-1, like CloudFront's: a Cognito custom domain is CloudFront. */
  readonly loginCertificateArn: string;
  readonly zoneDomain: string;
  readonly zoneId: string;
}

export class AuthStack extends Stack {
  readonly userPoolId: string;
  readonly userPoolClientId: string;
  readonly loginDomain: string;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    // The login certificate comes from the us-east-1 stack; this one is in
    // Milan.
    super(scope, id, { ...props, crossRegionReferences: true });

    const pool = new UserPool(this, 'Utenti', {
      signInAliases: { email: true },
      // One or two people, created by hand. An open pool on a public address
      // is an invitation.
      selfSignUpEnabled: false,
      // No self-service recovery: the email OTP is already an allowed first
      // factor, so a "forgot password" flow gives an attacker with the
      // inbox nothing they did not already have, while adding a reset link
      // the spec explicitly keeps out. A forgotten password is recovered by
      // signing in with the email code, or reset by admin.
      accountRecovery: AccountRecovery.NONE,
      // Passkeys do not exist on the Lite plan. This is the reason for the
      // plan, not a preference.
      featurePlan: FeaturePlan.ESSENTIALS,
      // The security floor of this whole app is the strength of this
      // password. Long and random, all character classes, so it earns its
      // place in a password manager instead of a sticky note.
      passwordPolicy: {
        minLength: 32,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        // Only exists to bridge admin-create to first sign-in.
        tempPasswordValidity: Duration.days(1),
      },
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
      // The login hostname itself, exactly — not the apex domain it sits
      // under. Two rules bind this value and the narrower one is Cognito's,
      // so it is the one to reason from:
      //
      //   "Under the following conditions, the passkey relying party ID must
      //   be the fully-qualified domain name of your custom domain: the user
      //   pool is configured for passkey authentication; the user pool has a
      //   custom domain, whether or not it also has a prefix domain; your
      //   application performs authentication with managed login or the
      //   classic hosted UI."
      //     — Cognito API reference, WebAuthnConfigurationType.RelyingPartyId
      //
      // All three hold here. WebAuthn on its own would also accept the apex
      // `vanessa.matteo.cool`, since the login host sits under it — which is
      // why the apex looks defensible and is not. Do not "simplify" this back
      // to `props.domain`: the browser would be satisfied and Cognito would
      // not, and nothing in a passing test run would say so.
      //
      // The domain still has to be one we control, which is the reason the
      // pool has a custom domain at all. Cognito's own prefix domain would
      // satisfy the rule above and bind every credential to a name we cannot
      // keep.
      //
      // Changing this value invalidates every passkey already registered
      // against the old one: each device has to enrol again. Free today —
      // no user exists — and permanently expensive after the first sign-in.
      passkeyRelyingPartyId: props.loginDomain,
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
        // One URL, the deployed one. `http://localhost:5173/` is deliberately
        // not here: registering it would make managed login redirect back to
        // a dev server whose `/api` proxy the origin secret refuses anyway,
        // so the reward would be a signed-in app that still loads nothing.
        // See `web/.env.development`.
        callbackUrls: [`https://${props.domain}/`],
        // Nothing calls `/logout` today — `esci()` clears local storage and
        // stops there, so the managed-login cookie outlives it, and the spec
        // puts a real logout out of scope. Kept anyway because Cognito
        // refuses a `/logout` whose `logout_uri` is not registered here:
        // with this line, adding logout later is a change to the frontend
        // alone; without it, it is a change to the pool as well.
        logoutUrls: [`https://${props.domain}/`],
      },
      // A day, so she touches Face ID once in the morning. OAuth's natural
      // behaviour is to never ask again, which is more convenient and leaves a
      // lost phone signed in for months.
      refreshTokenValidity: Duration.days(1),
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
    });

    // A domain of our own, not the `turni-vanessa.auth.<region>.amazoncognito.com`
    // prefix this used to be. The prefix domain is free and needs no
    // certificate, and it also makes the passkey impossible: see
    // `passkeyRelyingPartyId` above.
    const login = pool.addDomain('DominioAccesso', {
      customDomain: {
        domainName: props.loginDomain,
        certificate: Certificate.fromCertificateArn(
          this,
          'CertificatoAccesso',
          props.loginCertificateArn,
        ),
      },
      // Load-bearing, not a look. The default is the classic hosted UI, and
      // AWS is explicit that "passkey sign-in isn't available in the classic
      // hosted UI" — the choice-based factors are "only available to user
      // pools with managed login domains". Left at the default, the custom
      // domain above buys a correctly-scoped relying party id and a login
      // page that still never offers the passkey.
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    // Managed login refuses to serve a client that has no branding style, and
    // one is not created for us: Cognito attaches a default style only to app
    // clients made in the console. Ours is made by CloudFormation, which calls
    // `CreateUserPoolClient` — and per AWS, "managed login isn't available for
    // an app client created with an AWS SDK until you create one with a
    // CreateManagedLoginBranding request". So this resource is what makes the
    // login page exist at all, not what makes it pretty.
    //
    // `useCognitoProvidedValues` takes Cognito's own defaults, and requires
    // that `settings` and `assets` be omitted — there is nothing to design
    // here, only a style that has to be present.
    new CfnManagedLoginBranding(this, 'StileAccesso', {
      userPoolId: pool.userPoolId,
      clientId: client.userPoolClientId,
      useCognitoProvidedValues: true,
    });

    const zone = HostedZone.fromHostedZoneAttributes(this, 'Zona', {
      hostedZoneId: props.zoneId,
      zoneName: props.zoneDomain,
    });

    // Cognito serves a custom domain from a CloudFront distribution of its
    // own and does not point DNS at it for us: without this record the
    // hostname resolves to nothing and the login page is unreachable.
    new ARecord(this, 'RecordAccesso', {
      zone,
      recordName: props.loginDomain,
      target: RecordTarget.fromAlias(new UserPoolDomainTarget(login)),
    });

    this.userPoolId = pool.userPoolId;
    this.userPoolClientId = client.userPoolClientId;
    this.loginDomain = login.baseUrl();

    new CfnOutput(this, 'IdPool', { value: pool.userPoolId });
    new CfnOutput(this, 'IdClient', { value: client.userPoolClientId });
    new CfnOutput(this, 'DominioLogin', { value: login.baseUrl() });
  }
}
