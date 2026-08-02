/** ACM certificate. It lives in its own stack because CloudFront only accepts
 *  certificates from us-east-1, while everything else runs in Milan. */

import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { HostedZone, type IHostedZone } from 'aws-cdk-lib/aws-route53';
import { Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export interface CertificateStackProps extends StackProps {
  readonly domain: string;
  readonly zoneDomain: string;
  readonly zoneId: string;
}

export class CertificateStack extends Stack {
  readonly certificateArn: string;
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
  }
}
