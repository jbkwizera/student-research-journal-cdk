import * as cdk from 'aws-cdk-lib/core';
import {RemovalPolicy} from 'aws-cdk-lib/core';
import {Construct} from "constructs";
import {APP_SHORT_NAME, getResourceName, getResourceNamePrefix} from "../config/constants";
import {BlockPublicAccess, Bucket, BucketEncryption, HttpMethods, ObjectOwnership} from "aws-cdk-lib/aws-s3";
import {Duration} from "aws-cdk-lib";
import {CfnEmailIdentity} from "aws-cdk-lib/aws-ses";
import {PolicyStatement, User} from "aws-cdk-lib/aws-iam";

export interface StudentResearchJournalDevStackProps extends cdk.StackProps {
  /**
   * Email address that will send transaction emails (verification, password reset).
   * Must be a real address you can receive at - AWS will send a verification email.
   */
  readonly senderEmail: string;
}

export class StudentResearchJournalDevStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: StudentResearchJournalDevStackProps) {
    super(scope, id, props);

    const resourceNamePrefix = getResourceNamePrefix(this.account, this.region);

    // -------------------------------------------------------------------------
    // S3 bucket for local dev uploads
    // -------------------------------------------------------------------------
    // Same shape as prod FilesBucket so behavior is identical, but
    // removable on teardown since dev data is disposable.
    const filesBucket = new Bucket(this, 'FilesBucket', {
      bucketName: getResourceName(resourceNamePrefix, 'files-dev'),
      versioned: false,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,

      cors: [
        {
          allowedMethods: [HttpMethods.PUT, HttpMethods.GET, HttpMethods.HEAD],
          allowedOrigins: ['http://localhost:3030', 'http://localhost:8080'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],

      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: Duration.days(7) },
      ],

      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // -------------------------------------------------------------------------
    // SES sender identity
    // -------------------------------------------------------------------------
    // After deploy, AWS will email props.senderEmail with a verification link.
    // Click it before try to send.
    new CfnEmailIdentity(this, 'SenderEmailIdentity', {
      emailIdentity: props.senderEmail,
    });

    // -------------------------------------------------------------------------
    // IAM user for local Spring Boot to authenticate as
    // -------------------------------------------------------------------------
    const devUser = new User(this, 'LocalDevUser', {
      userName: `${APP_SHORT_NAME.toLowerCase()}-local-dev`,
    });

    // Grant S3 read/write on this specific bucket only
    filesBucket.grantReadWrite(devUser);

    // Grant SES send permissions, scoped to this identity
    devUser.addToPolicy(new PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: [
        `arn:aws:ses:${this.region}:${this.account}:identity/${props.senderEmail}`,
      ],
    }));

    // -------------------------------------------------------------------------
    // Outputs - surface what the developer needs to know
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'BucketName', {
      value: filesBucket.bucketName,
      description: 'S3 bucket name for local uploads',
    });

    new cdk.CfnOutput(this, 'BucketRegion', {
      value: this.region,
      description: 'S3 bucket region',
    });

    new cdk.CfnOutput(this, 'DevUserName', {
      value: devUser.userName,
      description: 'IAM user - create an access key in the console after deploy',
    });

    new cdk.CfnOutput(this, 'SenderEmail', {
      value: props.senderEmail,
      description: 'Sender email - check your inbox to verify the identity',
    });
  }
}
