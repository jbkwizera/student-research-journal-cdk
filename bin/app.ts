#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { StudentResearchJournalStack } from '../lib/student-research-journal-stack';

const app = new cdk.App();
new StudentResearchJournalStack(app, 'StudentResearchJournalStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'eu-west-1',
  },
});
