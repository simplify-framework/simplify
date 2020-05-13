### INSTRUCTIONS ###

`npm install simplify-sdk`

This is a JavaScript SDK that help DevOps easier by integrating deployment process inline to your code.

### Deploy for AWS Lambda Configuration: config.json

```Json
{
    "Region": "us-east-1",
    "Bucket": {
        "Name": "lambdaFunctionName-deployment",
        "Key": "builds/${DATE_TODAY}/latest-build.zip"
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
            "MODE": "development"
        },
        "Timeout": 15,
        "TracingConfig": {
            "Mode": "Active"
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
const provider = require('simplify/provider')

var config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json')))
provider.setConfig(config)
simplify.zipFolderThenUpload({
    adaptor: provider.getStorage(), ...{
        bucketKey: config.Bucket.Key,
        inputDirectory: path.join(__dirname, 'src'),
        outputFilePath: config.OutputFile
    }
}).then(function (uploadInfor) {
    simplify.createOrUpdateFunction({
        adaptor: provider.getFunction(),
        ...{
            functionConfig: config.Function,
            bucketName: config.Bucket.Name,
            bucketKey: uploadInfor.bucketKey
        }
    }).then(function (data) {
        console.log(`createLambdaFunction-WriteOutput: ${config.OutputFile}`);
        fs.writeFileSync(path.join(__dirname, config.OutputFile), JSON.stringify({
            FunctionName: data.FunctionName,
            FunctionArn: data.FunctionArn,
            LastModified: data.LastModified,
            CodeSha256: data.CodeSha256,
            RevisionId: data.RevisionId,
            LastUpdateStatus: data.LastUpdateStatus,
            LastUpdateStatusReason: data.LastUpdateStatusReason,
            LastUpdateStatusReasonCode: data.LastUpdateStatusReasonCode
        }, null, 4));
    }, function(err) {
        console.error(`createLambdaFunction-Upload-ERROR: ${err}`);
    })
})
```
