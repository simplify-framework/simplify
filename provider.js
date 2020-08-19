#!/usr/bin/env node
'use strict';

const AWS = require('aws-sdk')
const CBEGIN='\x1b[32m'
const CERROR='\x1b[31m'
const CRESET='\x1b[0m'
var awsconfig = {
    Region: 'us-east-1'
}
var s3BucketParams = {
    Bucket: 'simplify-default-deployment-acf0f0997c98633e06f765a8548392049ff16d6d',
    ACL: 'private'
}
process.env.AWS_SDK_LOAD_CONFIG = process.env.AWS_SDK_LOAD_CONFIG || true

module.exports = {
    setConfig: function (config) {
        return new Promise(function (resolve, reject) {
            AWS.CredentialProviderChain.defaultProviders = [
                function () { return new AWS.SharedIniFileCredentials(config.Profile ? { profile: config.Profile } : {}); },
                function () { return new AWS.EnvironmentCredentials('AWS'); },
                function () { return new AWS.ECSCredentials(); },
                function () { return new AWS.ProcessCredentials(); },
                function () { return new AWS.EC2MetadataCredentials() },
                function () { return new AWS.EnvironmentCredentials('AMAZON'); },
                function () { return new AWS.TokenFileWebIdentityCredentials(); }
            ]
            new AWS.CredentialProviderChain().resolve(function (err, credentials) {
                if (err) {
                    reject(err)
                } else {
                    AWS.config.update({ credentials: credentials });
                    console.log(`${CBEGIN}Simplify${CRESET} | AWSProvider-Credentials: ${AWS.config.credentials.profile ? AWS.config.credentials.profile : 'default'}`)
                    s3BucketParams.Bucket = (config.Bucket || {}).Name
                    if (config.Region != 'us-east-1') {
                        s3BucketParams.CreateBucketConfiguration = {
                            LocationConstraint: config.Region
                        }
                    }
                    if (config.ServerSideEncryption && config.SSEKMSKeyId) {
                        s3BucketParams.ServerSideEncryption = config.ServerSideEncryption
                        s3BucketParams.SSEKMSKeyId = config.SSEKMSKeyId
                    }
                    awsconfig = config
                    resolve(AWS.config.credentials)
                }
            });
        })
    },
    getStorage: function () {
        return new AWS.S3({
            apiVersion: '2006-03-01',
            params: s3BucketParams,
            region: awsconfig.Region
        })
    },
    getResource: function () {
        return new AWS.CloudFormation({
            apiVersion: '2010-05-15',
            region: awsconfig.Region
        })
    },
    getFunction: function () {
        return new AWS.Lambda({
            apiVersion: '2015-03-31',
            region: awsconfig.Region
        })
    },
    getAPIGateway: function () {
        return new AWS.APIGateway({
            apiVersion: '2015-07-09',
            region: awsconfig.Region
        })
    },
    getLogger: function () {
        return new AWS.CloudWatchLogs({
            apiVersion: '2014-03-28', region: awsconfig.Region
        })
    },
    getMetrics: function () {
        return new AWS.CloudWatch({
            apiVersion: '2010-08-01', region: awsconfig.Region
        })
    },
    getKMS: function () {
        return new AWS.KMS({
            apiVersion: '2014-11-01',
            region: awsconfig.Region
        })
    },
    getIAM: function () {
        return new AWS.IAM({
            apiVersion: '2010-05-08'
        })
    }
}
