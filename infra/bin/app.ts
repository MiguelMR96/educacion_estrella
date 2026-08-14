#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { EducacionEstrellaStack } from "../lib/educacion-estrella-stack";

const app = new cdk.App();

// Region is pinned to us-east-1 (as suggested by the assignment) rather than
// following the local AWS profile's default, so `cdk deploy` is deterministic
// regardless of which machine/profile runs it.
new EducacionEstrellaStack(app, "EducacionEstrellaStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-east-1",
  },
});
