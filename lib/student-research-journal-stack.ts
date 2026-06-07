import * as cdk from 'aws-cdk-lib/core';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { AllowedMethods, CachePolicy, Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { Cluster, ContainerImage, CpuArchitecture, OperatingSystemFamily, LogDriver, Secret, } from 'aws-cdk-lib/aws-ecs';
import { CfnEmailIdentity } from 'aws-cdk-lib/aws-ses';
import { Credentials, DatabaseInstance, DatabaseInstanceEngine, PostgresEngineVersion, StorageType,} from 'aws-cdk-lib/aws-rds';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { InstanceClass, InstanceSize, InstanceType, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';

import { Construct } from 'constructs';

import { APP_SHORT_NAME, getResourceName, getResourceNamePrefix } from '../config/constants';

export class StudentResearchJournalStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const resourceNamePrefix = getResourceNamePrefix(this.account, this.region);

    const vpc = new Vpc(this, 'Vpc', {
      vpcName: getResourceName(resourceNamePrefix, 'vpc'),
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private',
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    const logGroup = new LogGroup(this, 'LogGroup', {
      logGroupName: `/ecs/${APP_SHORT_NAME.toLowerCase()}-api`,
      retention: RetentionDays.ONE_MONTH,
    });

    const jwtSecret = new secretsmanager.Secret(this, 'JwtSecret', {
      secretName: `${APP_SHORT_NAME.toLowerCase()}-jwt-secret`,
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 64,
      },
    });

    const dbSecret = new secretsmanager.Secret(this, 'DBSecret', {
      secretName: `${APP_SHORT_NAME.toLowerCase()}-db-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: `${APP_SHORT_NAME.toLowerCase()}-admin` }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      }
    });

    const cluster = new Cluster(this, 'Cluster', {
      vpc,
    });

    const databaseInstance = new DatabaseInstance(this, 'DatabaseInstance', {
      credentials: Credentials.fromSecret(dbSecret),
      engine: DatabaseInstanceEngine.postgres({
        version: PostgresEngineVersion.VER_16,
      }),
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.SMALL),
      vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },

      databaseName: APP_SHORT_NAME.toLowerCase(),
      instanceIdentifier: `${APP_SHORT_NAME.toLowerCase()}-db`,

      allocatedStorage: 32,
      storageType: StorageType.GP3,
      storageEncrypted: true,

      backupRetention: Duration.days(7),
      deletionProtection: true,
      autoMinorVersionUpgrade: true,

      publiclyAccessible: false,

      removalPolicy: RemovalPolicy.RETAIN,
    });

    // TODO: Uncomment after first deploy when a public image is used.
    // ... image: ContainerImage.fromEcrRepository(ecrRepositry, 'latest')
    // const ecrRepository = new Repository(this, 'EcrRepository', {
    //   repositoryName: `${APP_SHORT_NAME.toLowerCase()}-api`,
    //   imageScanOnPush: true,
    //   lifecycleRules: [
    //     {
    //       description: 'Keep last 4 images',
    //       maxImageCount: 4,
    //     },
    //   ],
    // });

    const filesBucket = new Bucket(this, 'FilesBucket', {
      bucketName: getResourceName(resourceNamePrefix, 'files'),
      versioned: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,

      cors: [
        {
          allowedMethods: [HttpMethods.PUT, HttpMethods.GET, HttpMethods.HEAD],
          allowedOrigins: ['*'], // TODO: lock down to frontend origin
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],

      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: Duration.days(7) },
      ],
    });

    const filesDistribution = new Distribution(this, 'FilesDistribution', {
      comment: `${APP_SHORT_NAME} files CDN`,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(filesBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
      },
    });

    const fargateApiService = new ApplicationLoadBalancedFargateService(this, 'FargateApiService', {
      cluster,
      serviceName: `${APP_SHORT_NAME.toLowerCase()}-api`,
      loadBalancerName: `${APP_SHORT_NAME.toLowerCase()}-api-alb`,
      cpu: 1024,
      memoryLimitMiB: 2048,
      desiredCount: 2,
      publicLoadBalancer: true,

      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      healthCheckGracePeriod: Duration.seconds(120),

      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.ARM64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },

      taskImageOptions: {
        image: ContainerImage.fromRegistry('public.ecr.aws/docker/library/nginx:latest'),
        containerPort: 8080,
        containerName: 'api',
        environment: {
          AWS_REGION: this.region,
          DB_HOST: databaseInstance.dbInstanceEndpointAddress,
          DB_PORT: databaseInstance.dbInstanceEndpointPort,
          DB_NAME: APP_SHORT_NAME.toLowerCase(),
          CLOUDFRONT_DOMAIN: filesDistribution.distributionDomainName,
        },
        secrets: {
          DB_USERNAME: Secret.fromSecretsManager(dbSecret, 'username'),
          DB_PASSWORD: Secret.fromSecretsManager(dbSecret, 'password'),
          SRJ_JWT_SECRET: Secret.fromSecretsManager(jwtSecret),
        },
        logDriver: LogDriver.awsLogs({
          streamPrefix: 'api',
          logGroup,
        }),
      },
    });

    fargateApiService.targetGroup.configureHealthCheck({
      path: '/actuator/health',
      healthyHttpCodes: '200',
      interval: Duration.seconds(30),
      timeout: Duration.seconds(10),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });

    databaseInstance.connections.allowDefaultPortFrom(
      fargateApiService.service,
      'Allow Fargate API to connect to RDS'
    );

    dbSecret.grantRead(fargateApiService.taskDefinition.taskRole);
    jwtSecret.grantRead(fargateApiService.taskDefinition.taskRole);
    filesBucket.grantReadWrite(fargateApiService.taskDefinition.taskRole);
  }
}
