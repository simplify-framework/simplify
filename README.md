# Simplify Framework - JavaScript SDK
  
![NPM Downloads](https://img.shields.io/npm/dw/simplify-sdk)
![Package Version](https://img.shields.io/github/package-json/v/simplify-framework/simplify?color=green)

*This is a JavaScript SDK that help DevOps easier by integrating deployment process inline to your code. You will never want to be locked into any vendor for a tool. In FaaS architecture, a function can be very small but a project needs some (3-100) functions to orchestrate a workload. One CI/CD tool for all of them is quite vague to deploy your project when you just need to update one line of a function.*

By using this SDK, you can breakdown your CI/CD tool as a function. Once again, FaaS concept now being applied for DevOps process. When you are micro focused into a function, a micro CI/CD function is beside of you. You're always feel safe and be efficiency. Simplify CodeGen generates a first code for you. It works well enough until you need to customize for your best fit. Happy OpenSource ￦

To start, choose one of two serverless models: OpenAPI or GraphQL 
- [simplify-openapi](https://github.com/simplify-framework/simplify-openapi)
- [simplify-graphql](https://github.com/simplify-framework/simplify-graphql)

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
