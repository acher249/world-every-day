import {
  Duration,
  RemovalPolicy,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_route53 as route53,
  aws_route53_targets as route53Targets,
  aws_s3 as s3,
} from "aws-cdk-lib";
import { Construct } from "constructs";

export type StaticSiteProps = {
  certificate?: acm.ICertificate;
  domainName?: string;
  frameAncestor?: string;
  hostedZone?: route53.IHostedZone;
};

export class StaticSite extends Construct {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: StaticSiteProps = {}) {
    super(scope, id);

    if (Boolean(props.domainName) !== Boolean(props.certificate && props.hostedZone)) {
      throw new Error("A static-site domain requires both a certificate and hosted zone");
    }

    this.bucket = new s3.Bucket(this, "Bucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: true,
    });

    const rewrite = new cloudfront.Function(this, "RouteRewrite", {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) request.uri = uri + 'index.html';
  else if (uri.indexOf('.') === -1) request.uri = uri + '/index.html';
  return request;
}`),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    const responseHeadersPolicy = props.frameAncestor
      ? new cloudfront.ResponseHeadersPolicy(this, "EmbeddableSecurityHeaders", {
          securityHeadersBehavior: {
            contentSecurityPolicy: {
              contentSecurityPolicy: `frame-ancestors 'self' ${props.frameAncestor}`,
              override: true,
            },
            contentTypeOptions: { override: true },
            referrerPolicy: {
              override: true,
              referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
            },
            strictTransportSecurity: {
              accessControlMaxAge: Duration.days(365),
              includeSubdomains: true,
              override: true,
              preload: true,
            },
            xssProtection: { modeBlock: true, override: true, protection: true },
          },
        })
      : cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS;

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      certificate: props.certificate,
      defaultBehavior: {
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        functionAssociations: [{
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          function: rewrite,
        }],
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        responseHeadersPolicy,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: "index.html",
      domainNames: props.domainName ? [props.domainName] : undefined,
      enabled: true,
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 404, responsePagePath: "/404.html" },
      ],
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    if (props.domainName && props.hostedZone) {
      const target = route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(this.distribution),
      );
      new route53.ARecord(this, "AliasA", {
        recordName: props.domainName,
        target,
        zone: props.hostedZone,
      });
      new route53.AaaaRecord(this, "AliasAaaa", {
        recordName: props.domainName,
        target,
        zone: props.hostedZone,
      });
    }
  }
}
