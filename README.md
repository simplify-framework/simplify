### INSTRUCTIONS ###

`npm install simplify-sdk`

This is a JavaScript SDK that help DevOps easier by integrating deployment process inline to your code.

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
