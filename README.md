# Simplify Framework - Simplify SDK
  
*This is a JavaScript SDK that help DevOps easier by integrating deployment process inline to your code. You will never want to be locked into any vendor for a tool. In FaaS architecture, a function can be very small but a project needs some (3-100) functions to orchestrate a workload. One CI/CD tool for all of them is quite vague to deploy your project when you just need to update one line of a function.*

By using this SDK, you can breakdown your CI/CD tool as a function. Once again, FaaS concept now being applied for DevOps process. When you are micro focused into a function, a micro CI/CD function is beside of you. You're always feel safe and be efficiency. Simplify CodeGen generates a first code for you. It works well enough until you need to customize for your best fit. Happy OpenSource ￦

To start, goto [simplify-codegen](https://github.com/simplify-framework/simplify-codegen)

*`simplify-codegen` is a Node.js-based codegen using OpenAPI specs to generate your own project then use `simplify-sdk` for governance. This project was initially by tailoring from openapi-codegen to use the core code generation functionality to generate the lambda based node projects and AWS CloudFormation stack. There was many tailored code to become a powerful tool nowaday. Thanks to the initial openapi-codegen project that has saved time for developing an initial idea.*

## Divided code capability:
- `Nano` function: per individual method (/path/rc: GET) as a lambda function
- `Micro` function: per some methods (/path/ac: POST, PUT) as a lambda function
- `Kilo` function: per some resources (/path/rc, /path/ac) as a lambda function
- `Mono` application: as an application running on a docker-compose service

## Deployment mode capability:
- BlueGreen deployment: run `latest` version as `Blue` stage or `stable` version as `Green` stage
- Enforcement deployment: specify to run a custom enforcement version (e.g maintenance package mode)
- Canary deployment: run one of [`latest`,`stable`,`enforce`] version on-request by `x-canary-selection` HTTP header

## Software development facility:
- Production ready code skeleton (sanitizer, unit tests, api tests, coverage)
- Controllable logging verbosity (INFO, WARN, DEBUG, ERROR) using `debug` package
- Local and independant development code run (http://localhost:3000) by node `express`

## Install from published NPM packages
- `npm install -g simplify-codegen`

## Install codegen from github sourcode, link to dependancy system
- `git clone https://github.com/simplify-framework/codegen.git`
- `cd codegen && npm install && npm link`

## Generate Open API specs sample for pets:
- `mkdir pets-project` to create project folder for pets
- `cd pets-project && npm link simplify-codegen` if you install from github
- `simplify-codegen petsample` to generate OpenAPI 3.0 specs

## Generate project using command line:
- `simplify-codegen generate -i openapi.yaml` to generate code in the current folder
- `simplify-codegen generate -i openapi.yaml -o other-folder` to specify another folder

## Setup AWS configuration profile
- Create a deployment user in IAM: `simplify-user`
- Setup IAM Role policy using: `deployment-policy.json`
- Configure your machine `aws configure --profile simplify-eu`

## You are in the pets project directory
- `npm install` to install project dependancies and tools
- `npm run deploy` to provision code containers (AWS Lambda empty functions)
- `npm run latest` to deploy and run code as a latest version (DEPLOYMENT_STAGE=latest)
- `npm run stable` to deploy and run code as a stable version (DEPLOYMENT_STAGE=stable)

## Microservices architecture in AWS:
+ AWS API Gateway REST API
  + AWS Lambda function   (service #1)
    - AWS Secret Manager  (key vault)
    - Custom resource     (external setup)
    - Manage Policy Arn   (access policy)
  + AWS Lambda function   (service #2)
    - AWS Secret Manager  (key vault)
    - Custom resource     (external setup)
    - Manage Policy Arn   (access policy)
  + AWS Lambda function   (service #3)
    - AWS Secret Manager  (key vault)
    - Custom resource     (external setup)
    - Manage Policy Arn   (access policy)

### Simplify - JavaScript SDK ###

`npm install simplify-sdk`

### Deploy for AWS Lambda Configuration: config.json

```Json
{
    "Region": "us-east-1",
    "Bucket": {
        "Name": "lambdaFunctionName-deployment",
        "Key": "builds/${DATE_TODAY}"
    },
    "OutputFile": "function-meta.json",
    "Function": {
        "FunctionName": "lambdaFunctionName",
        "Handler": "index.handler",
        "MemorySize": 256,
        "Publish": true,
        "Role": "arn:aws:iam::1234567890:role/lambdaFunctionRole",
        "Runtime": "nodejs12.x",
        "Tags": {
            "Group": "Simplify"
        },
        "Timeout": 15,
        "TracingConfig": {
            "Mode": "PassThrough"
        },
        "Environment": {
            "Variables": {
                "ENV": "development",
                "FOO": "bar"
            }
        }
    }
}
```

### Deoloy AWS Lambda Function example: main.js
```Javascript
const path = require('path')
const fs = require('fs')
const simplify = require('simplify-sdk')
const provider = require('simplify-sdk/provider')

var config = simplify.getInputConfig(path.join(__dirname, 'config.json'))
const functionConfig = config.Function
const bucketName = config.Bucket.Name
const bucketKey = config.Bucket.Key

provider.setConfig(config) {
    simplify.uploadDirectoryAsZip({
        adaptor: provider.getStorage(), ...{
            bucketKey, 'input/Directory', 'output/File/Path'
        }
    }).then(function (uploadInfor) {
        simplify.createOrUpdateFunction({
            adaptor: provider.getFunction(),
            ...{ functionConfig, bucketName, bucketKey: uploadInfor.Key }
        }).then(function (data) {
            // Handle data response
        }, function(err) {
            console.error(`Update-ERROR: ${err}`);
        })
    }, function(err) {
        console.error(`UploadZip-ERROR: ${err}`);
    })
})
```
