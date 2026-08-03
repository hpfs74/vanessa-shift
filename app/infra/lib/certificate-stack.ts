/** ACM certificates. They live in their own stack because CloudFront only
 *  accepts certificates from us-east-1, while everything else runs in Milan.
 *  A Cognito custom domain has the same rule — it is CloudFront underneath —
 *  so the login certificate belongs here too, even though the user pool it
 *  serves is in Milan with the rest. */

import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { HostedZone, type IHostedZone } from 'aws-cdk-lib/aws-route53';
import { Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export interface CertificateStackProps extends StackProps {
  readonly domain: string;
  /** Hostname of the managed login page, e.g. `auth.<domain>`. */
  readonly loginDomain: string;
  readonly zoneDomain: string;
  readonly zoneId: string;
}

export class CertificateStack extends Stack {
  readonly certificateArn: string;
  readonly loginCertificateArn: string;
  readonly zone: IHostedZone;

  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    super(scope, id, { ...props, crossRegionReferences: true });

    this.zone = HostedZone.fromHostedZoneAttributes(this, 'Zona', {
      hostedZoneId: props.zoneId,
      zoneName: props.zoneDomain,
    });

    const cert = new Certificate(this, 'Certificato', {
      domainName: props.domain,
      validation: CertificateValidation.fromDns(this.zone),
    });

    this.certificateArn = cert.certificateArn;

    // A second certificate, deliberately — not a subject alternative name on
    // the one above. ACM has no way to add a name to an existing certificate:
    // changing the domain list issues a new one and CloudFormation replaces
    // it, and that certificate is serving the live distribution. Two
    // certificates cost nothing and neither can take the other down.
    const loginCert = new Certificate(this, 'CertificatoAccesso', {
      domainName: props.loginDomain,
      validation: CertificateValidation.fromDns(this.zone),
    });

    this.loginCertificateArn = loginCert.certificateArn;
  }
}
