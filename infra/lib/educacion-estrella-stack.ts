import * as crypto from "crypto";
import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";

const BACKEND_ROOT = path.join(__dirname, "..", "..", "backend");
const BACKEND_SRC = path.join(BACKEND_ROOT, "src");

export class EducacionEstrellaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---------------------------------------------------------------------
    // Frontend hosting: S3 static website bucket. Only static build assets
    // (no secrets) ever live here, so public GetObject is acceptable. We use
    // S3 website hosting instead of CloudFront to keep deploys fast and free
    // (no distribution to provision/invalidate) - documented trade-off: no
    // custom domain/HTTPS/CDN caching, which is what CloudFront would add.
    // ---------------------------------------------------------------------
    const frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      websiteIndexDocument: "index.html",
      websiteErrorDocument: "index.html", // SPA client-side routing fallback
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicPolicy: false,
        restrictPublicBuckets: false,
        blockPublicAcls: true,
        ignorePublicAcls: true,
      }),
      publicReadAccess: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const frontendOrigin = frontendBucket.bucketWebsiteUrl;

    // ---------------------------------------------------------------------
    // Video storage: private bucket, never public. Access only via
    // short-lived presigned POST (upload) / GET (future playback) URLs.
    // ---------------------------------------------------------------------
    const videosBucket = new s3.Bucket(this, "VideosBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: [frontendOrigin, "http://localhost:5173"],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: cdk.Duration.days(1) }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ---------------------------------------------------------------------
    // Data: DynamoDB, on-demand billing (free tier: 25GB + 25 RCU/WCU
    // equivalent, no idle cost - a good fit vs. RDS for this scope).
    // ---------------------------------------------------------------------
    const usersTable = new dynamodb.Table(this, "UsersTable", {
      partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const applicationsTable = new dynamodb.Table(this, "ApplicationsTable", {
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ---------------------------------------------------------------------
    // Auth secret: a fresh random value generated at synth time and injected
    // as a Lambda env var (encrypted at rest by Lambda's default AWS-managed
    // KMS key, at no cost). Secrets Manager would be the more rotation-
    // friendly choice but isn't free tier after the first 30 days; documented
    // as a "would change with more budget/time" trade-off in the README.
    // ---------------------------------------------------------------------
    const jwtSecret = crypto.randomBytes(48).toString("hex");

    const commonEnv = {
      CORS_ORIGIN: frontendOrigin,
      JWT_SECRET: jwtSecret,
    };

    const bundling: lambdaNode.BundlingOptions = {
      externalModules: [], // bundle every dependency, incl. AWS SDK v3 helper packages
      minify: true,
      target: "node20",
    };
    const projectRoot = BACKEND_ROOT;
    const depsLockFilePath = path.join(BACKEND_ROOT, "package-lock.json");

    const authFn = new lambdaNode.NodejsFunction(this, "AuthFunction", {
      entry: path.join(BACKEND_SRC, "handlers", "auth.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      bundling,
      projectRoot,
      depsLockFilePath,
      environment: { ...commonEnv, USERS_TABLE: usersTable.tableName },
    });
    usersTable.grantReadWriteData(authFn);

    const applicationsFn = new lambdaNode.NodejsFunction(this, "ApplicationsFunction", {
      entry: path.join(BACKEND_SRC, "handlers", "applications.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      bundling,
      projectRoot,
      depsLockFilePath,
      environment: {
        ...commonEnv,
        APPLICATIONS_TABLE: applicationsTable.tableName,
        VIDEOS_BUCKET: videosBucket.bucketName,
      },
    });
    applicationsTable.grantReadWriteData(applicationsFn);
    videosBucket.grantPut(applicationsFn);
    videosBucket.grantRead(applicationsFn); // HeadObject check after upload

    // ---------------------------------------------------------------------
    // API: HTTP API (cheaper + simpler than REST API for this scope).
    // CORS is restricted to the deployed frontend origin, with credentials
    // enabled since auth uses an httpOnly session cookie.
    // ---------------------------------------------------------------------
    const httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      corsPreflight: {
        allowOrigins: [frontendOrigin, "http://localhost:5173"],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST],
        allowHeaders: ["Content-Type"],
        allowCredentials: true,
      },
    });

    const authIntegration = new integrations.HttpLambdaIntegration("AuthIntegration", authFn);
    const applicationsIntegration = new integrations.HttpLambdaIntegration(
      "ApplicationsIntegration",
      applicationsFn
    );

    httpApi.addRoutes({
      path: "/auth/{proxy+}",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: authIntegration,
    });
    httpApi.addRoutes({
      path: "/applications",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: applicationsIntegration,
    });
    httpApi.addRoutes({
      path: "/applications/{proxy+}",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: applicationsIntegration,
    });

    // ---------------------------------------------------------------------
    // Frontend static assets. Requires `npm run build` in frontend/ to have
    // already produced frontend/dist with VITE_API_URL pointed at this
    // API - see the deploy script in the README for the required order.
    // ---------------------------------------------------------------------
    new s3deploy.BucketDeployment(this, "FrontendDeployment", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "..", "..", "frontend", "dist"))],
      destinationBucket: frontendBucket,
    });

    new cdk.CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, "FrontendUrl", { value: frontendOrigin });
    new cdk.CfnOutput(this, "VideosBucketName", { value: videosBucket.bucketName });
  }
}
