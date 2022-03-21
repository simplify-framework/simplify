# Simplify Framework - JavaScript SDK
  
![NPM Downloads](https://img.shields.io/npm/dw/simplify-sdk)
![Package Version](https://img.shields.io/github/package-json/v/simplify-framework/simplify?color=green)

*This is a JavaScript SDK that help DevOps easier by integrating deployment process inline to your code. You will never want to be locked into any vendor for a tool. In FaaS architecture, a function can be very small but a project needs some (3-100) functions to orchestrate a workload. One CI/CD tool for all of them is quite vague to deploy your project when you just need to update one line of a function.*

By using this SDK, you can breakdown your CI/CD tool as a function. Once again, FaaS concept now being applied for DevOps process. When you are micro focused into a function, a micro CI/CD function is beside of you. You're always feel safe and be efficiency. Simplify CodeGen generates a first code for you. It works well enough until you need to customize for your best fit. Happy OpenSource ￦

To start, choose one of two serverless models: OpenAPI or GraphQL 
- [simplify-openapi](https://github.com/simplify-framework/openapi)
- [simplify-graphql](https://github.com/simplify-framework/graphql)

### Simplify - JavaScript SDK ###

`npm install simplify-sdk`

### Deploy for AWS Lambda Configuration: config.json

```Json
{
    "Profile": "${DEPLOYMENT_PROFILE}",
    "Region": "${DEPLOYMENT_REGION}",
    "Bucket": {
        "Name": "${DEPLOYMENT_BUCKET}",
        "Key": "builds/${DATE_TODAY}"
    },
    "Function": {
        "FunctionName": "${FUNCTION_NAME}",
        "Handler": "index.handler",
        "MemorySize": 256,
        "Publish": true,
        "Role": "${FUNCTION_ROLE}",
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
                "ENV": "development"
            }
        }
    }
}
```

### Deoloy AWS Lambda Function example: main.js
```Javascript
'use strict';
const path = require('path')
const fs = require('fs')
const simplify = require('simplify-sdk')
const provider = require('simplify-sdk/provider')

const YOUR_DEPLOYMENT_REGION = "eu-west-1"
const YOUR_DEPLOYMENT_BUCKET = "your-deployment-bucket-2873821"
const YOUR_FUNCTION_NAME = "YourLambdaFunction-1WDRZ5J5OUN5H"
const YOUR_FUNCTION_ROLE = "arn:aws:iam::01234567890:role/YourLambdaExecutionRole"
var YOUR_FUNCTION_SHA256 = "LOAD_FROM_OUTPUT_FILE__data.YOUR_FUNCTION_SHA256"

var config = simplify.getInputConfig(path.join(__dirname, 'config.json'), {
    DEPLOYMENT_BUCKET: YOUR_DEPLOYMENT_BUCKET,
    DEPLOYMENT_REGION: YOUR_DEPLOYMENT_REGION,
    FUNCTION_NAME: YOUR_FUNCTION_NAME,
    FUNCTION_ROLE: YOUR_FUNCTION_ROLE
})

provider.setConfig(config).then(sessionCreds => {
    simplify.uploadDirectoryAsZip({
        adaptor: provider.getStorage(), ...{
            bucketKey: config.Bucket.Key,
            inputDirectory: 'src',
            outputFilePath: 'dist',
            hashInfo: { FileSha256: YOUR_FUNCTION_SHA256 }
        }
    }).then(uploadInfor => {
        simplify.createOrUpdateFunction({
            adaptor: provider.getFunction(),
            ...{
                functionConfig: config.Function,
                bucketName: config.Bucket.Name,
                bucketKey: uploadInfor.Key
            }
        }).then(function (data) {
            // Handle data response: save output to file...
            data.YOUR_FUNCTION_SHA256 = uploadInfor.FileSha256
            console.log(`Update-Function: ${data}`)
        }, function(err) {
            console.error(`Update-ERROR: ${err}`);
        })
    }).catch(err => {
        console.error(`UploadZip-ERROR: ${err}`);
    })
})
```

Thí library curently support for AWS Lambda only.
