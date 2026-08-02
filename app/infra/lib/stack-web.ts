/** Certificato ACM. Sta in uno stack a parte perche' CloudFront accetta
 *  certificati solo da us-east-1, mentre tutto il resto vive a Milano. */

import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { HostedZone, type IHostedZone } from 'aws-cdk-lib/aws-route53';
import { Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export interface StackCertificatoProps extends StackProps {
  readonly dominio: string;
  readonly zonaDominio: string;
  readonly zonaId: string;
}

export class StackCertificato extends Stack {
  readonly certificatoArn: string;
  readonly zona: IHostedZone;

  constructor(scope: Construct, id: string, props: StackCertificatoProps) {
    super(scope, id, { ...props, crossRegionReferences: true });

    this.zona = HostedZone.fromHostedZoneAttributes(this, 'Zona', {
      hostedZoneId: props.zonaId,
      zoneName: props.zonaDominio,
    });

    const cert = new Certificate(this, 'Certificato', {
      domainName: props.dominio,
      validation: CertificateValidation.fromDns(this.zona),
    });

    this.certificatoArn = cert.certificateArn;
  }
}
