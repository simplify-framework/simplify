#!/usr/bin/env node
'use strict';
const path = require('path')
const crypto = require('crypto')
const fs = require('fs')
const AdmZip = require('adm-zip')
const utilities = require('./utilities')
const CBEGIN = '\x1b[32m'
const CERROR = '\x1b[31m'
const CNOTIF = '\x1b[33m'
const CRESET = '\x1b[0m'
const CDONE = '\x1b[37m'
/**
 * [Storage] adaptor.createBucket(params, callback)
 * [Storage] adaptor.upload(params, callback)
 * [Function] adaptor.createFunction(params, callback)
 * [Function] adaptor.updateFunctionCode(params, callback)
 * [Function] adaptor.updateFunctionConfiguration(params, callback)
 * [Function] adaptor.getLayerVersion(params, callback)
 * [Function] adaptor.getFunction(params, callback)
 * [Function] adaptor.publishLayerVersion(params, callback)
 * [Resource] adaptor.createStack(params, callback)
 * [Resource] adaptor.updateStack(params, callback)
 * [Resource] adaptor.deleteStack(params, callback)
 * [Resource] adaptor.describeStacks(params, callback)
 * [APIGateway] adaptor.updateStage(params, callback)
 * [APIGateway] adaptor.createDeployment(params, callback)
 * [KMS] adaptor.getKeyPolicy(params, callback)
 * [KMS] adaptor.putKeyPolicy(params, callback)
 * [CloudWatchLog] adaptor.associateKmsKey(params, callback)
 * [CloudWatchLog] adaptor.disassociateKmsKey(params, callback)
 * [CloudWatchLog] adaptor.putRetentionPolicy(params, callback)
 * [CloudWatch] adaptor.getMetricStatistics(params, callback)
 * [IAM] adaptor.updateRolePolicy(params, callback)
 * [IAM] adaptor.deleteRolePolicy(params, callback)
 * [IAM] adaptor.createRole(params, callback)
 * [IAM] adaptor.deleteRole(params, callback)
 */

const showBoxBanner = function () {
    console.log("╓───────────────────────────────────────────────────────────────╖")
    console.log(`║              Simplify Framework - Version ${require('./package.json').version}              ║`)
    console.log("╙───────────────────────────────────────────────────────────────╜")
}

const getFunctionSha256 = function (outputFilePath, name) {
    if (fs.existsSync(outputFilePath)) {
        let configOutput = JSON.parse(fs.readFileSync(outputFilePath))
        return {
            FileSha256: configOutput.Configuration.Environment.Variables[name],
            HashSource: configOutput.Configuration.FunctionName
        }
    }
    return {
        FileSha256: "NOT_FOUND"
    }
}

const getContentArgs = function (...args) {
    var template = args.shift()
    function parseVariables(v) {
        args.forEach(function (a) {
            if (typeof a === 'object') {
                Object.keys(a).map(function (i) {
                    if (a[i]) {
                        v = v.replace(new RegExp('\\${' + i + '}', 'g'), a[i])
                    }
                })
            }
        })
        Object.keys(process.env).map(function (e) {
            v = v.replace(new RegExp('\\${' + e + '}', 'g'), process.env[e])
        })
        v = v.replace(/\${DATE_TODAY}/g, utilities.getDateToday()).replace(/\${TIME_MOMENT}/g, utilities.getTimeMoment())
        if (typeof args[args.length-1] === 'boolean' && args[args.length-1] === true) {
            v = v.replace(new RegExp(/ *\{[^)]*\} */, 'g'), `(not set)`).replace(new RegExp('\\$', 'g'),'')
        }
        return v
    }
    function parseKeyValue(obj) {
        Object.keys(obj).map(function (k, i) {
            if (typeof obj[k] === 'string') obj[k] = parseVariables(obj[k])
            else if (Array.isArray(obj)) obj[i] = parseKeyValue(obj[i])
            else if (typeof obj[k] === 'object') obj[k] = parseKeyValue(obj[k])
        })
        return obj
    }
    return parseKeyValue(template)
}

const getInputConfig = function (...args) {
    let config = {}, firstParam = args.shift()
    if (typeof firstParam === 'string') {
        config = JSON.parse(fs.readFileSync(firstParam))
    } else {
        config = firstParam
    }
    return getContentArgs(config, ...args)
}

const getContentFile = getInputConfig;

const updateFunctionRolePolicy = function (options) {
    var { adaptor, opName, policyName, policyDocument, functionConfig } = options
    opName = opName || `updateFunctionRolePolicy`
    const roleName = functionConfig.Role.split('/')[1]
    var params = {
        PolicyDocument: JSON.stringify(policyDocument),
        PolicyName: policyName || `${roleName}AttachedPolicy`,
        RoleName: roleName
    };
    return new Promise(function (resolve, reject) {
        adaptor.putRolePolicy(params, function (err, data) {
            err ? reject(err) : resolve(data)
        });
    })
}

const createOrUpdateFunctionRole = function (options) {
    var { adaptor, opName, roleName, policyDocument, assumeRoleDocument } = options
    opName = opName || `createFunctionRole`
    var params = {
        AssumeRolePolicyDocument: assumeRoleDocument || `{
            "Version": "2012-10-17",
            "Statement": [
               {
                  "Effect": "Allow",
                  "Principal": {
                     "Service": [
                        "lambda.amazonaws.com"
                     ]
                  },
                  "Action": [
                     "sts:AssumeRole"
                  ]
               }
            ]
        }`,
        Path: "/",
        RoleName: roleName
    };
    return new Promise(function (resolve, reject) {
        adaptor.getRole({
            RoleName: roleName
        }, function (err, data) {
            function createRolePolicy(data) {
                policyDocument ? adaptor.putRolePolicy({
                    PolicyDocument: JSON.stringify(policyDocument),
                    PolicyName: `${roleName}Policy`,
                    RoleName: roleName
                }, function (err) {
                    err ? reject(err) : resolve(data)
                }) : resolve(data)
            }
            if (err) {
                consoleWithMessage(`${opName}-Create`, `${roleName.truncate(50)}`)
                adaptor.createRole(params, function (err, data) {
                    err ? reject(err) : createRolePolicy(data)
                })
            } else {
                consoleWithMessage(`${opName}-Update`, `${roleName.truncate(50)}`)
                createRolePolicy(data)
            }
        })
    })
}

const deleteFunctionRolePolicy = function (options) {
    var { adaptor, opName, policyName, functionConfig } = options
    opName = opName || `deleteFunctionRolePolicy`
    const roleName = functionConfig.Role.split('/')[1]
    var params = {
        PolicyName: policyName || `${roleName}AttachedPolicy`,
        RoleName: roleName
    };
    return new Promise(function (resolve) {
        adaptor.deleteRolePolicy(params, function () {
            resolve(params)
        });
    })
}

const deleteFunctionRole = function (options) {
    var { adaptor, opName, roleName } = options
    opName = opName || `deleteFunctionRole`
    var params = {
        RoleName: roleName
    };
    return new Promise(function (resolve, reject) {
        adaptor.deleteRolePolicy({
            PolicyName: `${roleName}Policy`,
            RoleName: roleName
        }, function () {
            adaptor.deleteRole(params, function () {
                resolve({ roleName })
            });
        });
    })
}

const createOrUpdateStack = function (options) {
    var { adaptor, opName, stackName, stackParameters, stackTemplate } = options
    opName = opName || `createOrUpdateStack`
    function getParameters(params) {
        return Object.keys(params).map(function (k) {
            return {
                ParameterKey: k,
                ParameterValue: params[k],
                ResolvedValue: params[k],
                UsePreviousValue: false
            }
        })
    }
    return new Promise(function (resolve, reject) {
        var params = {
            StackName: stackName,
            Capabilities: [
                "CAPABILITY_IAM",
                "CAPABILITY_NAMED_IAM",
                "CAPABILITY_AUTO_EXPAND"
            ],
            EnableTerminationProtection: process.env.STACK_PROTECTION || false,
            OnFailure: process.env.STACK_ON_FAILURE || "ROLLBACK", //DO_NOTHING | DELETE
            Parameters: getParameters(stackParameters),
            RollbackConfiguration: {
                MonitoringTimeInMinutes: 0
            },
            Tags: [{ Key: 'Framework', Value: 'Simplify' }],
            TemplateURL: stackTemplate,
            TimeoutInMinutes: 15
        };
        adaptor.createStack(params, function (err, data) {
            if (err) {
                if (err.code == 'AlreadyExistsException') {
                    delete params.EnableTerminationProtection
                    delete params.OnFailure
                    delete params.TimeoutInMinutes
                    adaptor.updateStack(params, function (err, data) {
                        err ? reject(err) : resolve(data)
                    })
                } else {
                    reject(err)
                }
            }
            else {
                resolve(data)
            }
        });
    })
}

const deleteExistingStack = function (options) {
    var { adaptor, opName, stackName } = options
    opName = opName || `deleteExistingStack`
    var params = {
        StackName: stackName
    };
    return new Promise(function (resolve, reject) {
        adaptor.deleteStack(params, function (err, data) {
            err ? reject(err) : resolve(data)
        });
    })
}

const checkStackStatusOnComplete = function (options, stackData) {
    var { adaptor, opName } = options
    opName = opName || `checkStackStatusOnComplete`
    return new Promise(function (resolve, reject) {
        var params = {
            StackName: stackData.StackId || stackData.StackName
        };
        adaptor.describeStacks(params, function (err, data) {
            if (err) resolve({
                Error: err,
                StackStatus: stackData.StackStatus,
                StackName: stackData.StackName,
                StackId: stackData.StackId
            }); // resolve to FINISH in case there was an error
            else {
                var currentStack = data.Stacks.length > 0 ? data.Stacks[0] : stackData
                if (data.Stacks.length && (
                    currentStack.StackStatus == "UPDATE_COMPLETE" ||
                    currentStack.StackStatus == "UPDATE_ROLLBACK_COMPLETE" ||
                    currentStack.StackStatus == "UPDATE_FAILED" ||
                    currentStack.StackStatus == "CREATE_COMPLETE" ||
                    currentStack.StackStatus == "ROLLBACK_COMPLETE" ||
                    currentStack.StackStatus == "ROLLBACK_FAILED" ||
                    currentStack.StackStatus == "DELETE_COMPLETE" ||
                    currentStack.StackStatus == "DELETE_FAILED"
                )) {
                    adaptor.describeStackEvents(params, function (err, data) {
                        if (err) resolve(currentStack)
                        else {
                            const errorMessages = data.StackEvents.map(stackEvent => {
                                if (stackEvent.ResourceStatusReason && (
                                    stackEvent.ResourceStatus === "DELETE_FAILED" ||
                                    stackEvent.ResourceStatus === "ROLLBACK_FAILED" ||
                                    stackEvent.ResourceStatus === "CREATE_FAILED" ||
                                    stackEvent.ResourceStatus === "UPDATE_FAILED" ||
                                    stackEvent.ResourceStatus === "IMPORT_FAILED"
                                )) {
                                    return `${CRESET}(${stackEvent.LogicalResourceId}) - ${CERROR}${stackEvent.ResourceStatus}${CRESET} - ${CNOTIF}${stackEvent.ResourceStatusReason}${CRESET}`
                                }
                            }).filter(msgNotNull => msgNotNull).reduce((arr, item) => [
                                ...arr.filter((obj) => obj.ResourceStatusReason !== item.ResourceStatusReason), item
                            ], []);
                            if (currentStack.StackStatus == "UPDATE_COMPLETE" ||
                                currentStack.StackStatus == "CREATE_COMPLETE" ||
                                currentStack.StackStatus == "DELETE_COMPLETE") {
                                resolve(currentStack)
                            } else {
                                resolve({
                                    Error: {
                                        message: errorMessages.join('\n - ')
                                    },
                                    StackStatus: currentStack.StackStatus,
                                    StackName: currentStack.StackName,
                                    StackId: currentStack.StackId
                                })
                            }
                        }
                    })
                } else {
                    // reject to CONTINUE, in case --deletion the stack will be disapeared with undefined
                    if (!currentStack.StackStatus && currentStack.ResponseMetadata) {
                        resolve({ StackStatus: 'CLEANUP_COMPLETE' })
                    } else {

                        reject(currentStack)
                    }
                }
            }
        });
    })
}

const uploadLocalDirectory = function (options) {
    var { adaptor, opName, publicACL, bucketName, bucketKey, inputDirectory } = options
    opName = opName || `uploadLocalDirectory`
    return new Promise(function (resolve, reject) {
        adaptor.createBucket(function (err) {
            if (!err || (err.code == 'BucketAlreadyOwnedByYou')) {
                utilities.getFilesInDirectory(inputDirectory).then(function (files) {
                    var index = 0
                    var fileInfos = []
                    files.forEach(function (filePath) {
                        var fileKeyName = filePath.replace(inputDirectory, '').replace(/^\/+/, '').replace(/^\\+/, '')
                        fileKeyName = fileKeyName.replace(/\\+/g, '/')
                        fs.readFile(filePath, function (err, data) {
                            if (err) reject(err)
                            else {
                                var params = {
                                    Key: bucketKey ? (bucketKey + '/' + fileKeyName) : fileKeyName,
                                    Body: data
                                };
                                if (bucketName) {
                                    params.Bucket = bucketName
                                }
                                if (publicACL) {
                                    params.ACL = 'public-read'
                                    params.ContentDisposition = 'inline'
                                    var fileName = path.basename(fileKeyName)
                                    params.ContentType =
                                        fileName.endsWith('.html') ? 'text/html' :
                                            fileName.endsWith('.css') ? 'text/css' :
                                                fileName.endsWith('.js') ? 'application/javascript' :
                                                    'application/octet-stream'
                                }
                                consoleWithMessage(`\t Uploading-InProgress`, `\t${0} %`);
                                adaptor.upload(params).on('httpUploadProgress', event => {
                                    consoleWithMessage(`\t Uploading-InProgress`, `\t${parseInt(100 * event.loaded / event.total)} %`);
                                }).send((err, data) => {
                                    if (err) {
                                        consoleWithMessage(`${opName}-FileUpload`, `${CERROR}(ERROR)${CRESET} ${err}`)
                                        reject(err)
                                    } else {
                                        fileInfos.push(data)
                                        consoleWithMessage(`${opName}-FileUpload`, `${params.Key}`)
                                        if (++index >= files.length) {
                                            resolve(fileInfos)
                                        }
                                    }
                                })
                            }
                        })
                    })
                }).catch(err => reject(err))
            } else {
                if (err.code == 'BucketAlreadyExists') {
                    consoleWithMessage(`${opName}-CreateBucket`, `${CERROR}(ERROR)${CRESET} ${err} *** It has been created by another AWS Account worldwide!`)
                } else {
                    consoleWithMessage(`${opName}-CreateBucket`, `${CERROR}(ERROR)${CRESET} ${err}`)
                }
                reject(err)
            }
        })
    })
}

const uploadLocalFile = function (options) {
    var { adaptor, opName, bucketName, bucketKey, inputLocalFile } = options
    opName = opName || `uploadLocalFile`
    var uploadFileName = path.basename(inputLocalFile)
    return new Promise(function (resolve, reject) {
        try {
            consoleWithMessage(`${opName}-ReadFile`, `${inputLocalFile.truncate(50)}`)
            fs.readFile(inputLocalFile, function (err, data) {
                if (err) throw err;
                adaptor.createBucket(function (err) {
                    var params = {
                        Key: bucketKey ? (bucketKey + '/' + uploadFileName) : uploadFileName,
                        Body: data
                    };
                    if (bucketName) {
                        params.Bucket = bucketName
                    }
                    if (!err || (err.code == 'BucketAlreadyOwnedByYou')) {
                        consoleWithMessage(`\t Uploading-InProgress`, `\t${0} %`);
                        adaptor.upload(params).on('httpUploadProgress', event => {
                            consoleWithMessage(`\t Uploading-InProgress`, `\t${parseInt(100 * event.loaded / event.total)} %`);
                        }).send((err, data) => {
                            if (err) {
                                consoleWithMessage(`${opName}-FileUpload`, `${CERROR}(ERROR)${CRESET} ${err}`)
                                reject(err)
                            } else {
                                consoleWithMessage(`${opName}-FileUpload`, `${data.Location.truncate(50)}`)
                                resolve({ ...data })
                            }
                        })
                    } else {
                        consoleWithMessage(`${opName}-CreateBucket`, `${CERROR}(ERROR)${CRESET} ${err}`)
                        reject(err)
                    }
                })
            })
        } catch (err) {
            reject(err)
        }
    })
}

const uploadDirectoryAsZip = function (options) {
    var { adaptor, opName, bucketKey, inputDirectory, outputFilePath, hashInfo, fileName } = options
    opName = opName || `uploadDirectoryAsZip`
    var outputZippedFile = `${fileName || utilities.getDateToday()}.zip`
    var outputZippedFilePath = path.join(outputFilePath, outputZippedFile)
    return new Promise(function (resolve, reject) {
        try {
            const zip = new AdmZip();
            if (!fs.existsSync(outputFilePath)) {
                fs.mkdirSync(outputFilePath, { recursive: true })
            }
            zip.addLocalFolder(inputDirectory)
            zip.writeZip(outputZippedFilePath)
            consoleWithMessage(`${opName}-ZipFile`, `${inputDirectory.truncate(30)} > ${outputZippedFilePath.truncate(30)}`)
            const zipBuffer = Buffer.concat(zip.getEntries().map(e => {
                return e.getData()
            }))
            const sha256Hex = crypto.createHash('sha256').update(zipBuffer).digest('hex')
            if (sha256Hex === hashInfo.FileSha256) {
                resolve({ ...hashInfo, isHashIdentical: true })
            } else {
                uploadLocalFile({ adaptor, opName, bucketKey, inputLocalFile: outputZippedFilePath }).then(function (data) {
                    resolve({ ...data, FileSha256: sha256Hex, isHashIdentical: false })
                }).catch(function (err) { reject(err) })
            }
        } catch (err) {
            consoleWithMessage(`${opName}-ZipFile`, `${CERROR}(ERROR)${CRESET} ${err}`);
            reject(err)
        }
    })
}

const createOrUpdateFunction = function (options) {
    var { adaptor, opName, bucketName, bucketKey, functionConfig, creationTimeout } = options
    opName = opName || `createOrUpdateFunction`
    creationTimeout = creationTimeout || 10
    return new Promise(function (resolve, reject) {
        var params = {
            Code: {
                S3Bucket: bucketName,
                S3Key: bucketKey
            },
            ...functionConfig
        };
        consoleWithMessage(`${opName}-CreateFunction`, `${functionConfig.FunctionName.truncate(50)}`);
        adaptor.createFunction(params, function (err, data) {
            if (err) {
                if (err.code === 'ResourceConflictException') {
                    consoleWithMessage(`${opName}-UpdateFunctionConfig`, `${functionConfig.FunctionName.truncate(50)}`, err);
                    const unusedProps = ["Code", "Publish", "Tags"]
                    unusedProps.forEach(function (k) { delete params[k] })
                    adaptor.updateFunctionConfiguration(params, function (err, data) {
                        if (err) {
                            reject(err)
                        } else {
                            adaptor.waitFor('functionUpdated', { FunctionName: data.FunctionArn }, function(err, data) {
                                if (err) {
                                    reject(err);
                                } else {
                                    consoleWithMessage(`${opName}-UpdateFunctionConfig`, `${CDONE}(OK)${CRESET}`);
                                    adaptor.updateFunctionCode({
                                         FunctionName: functionConfig.FunctionName,
                                         S3Bucket: bucketName,
                                         S3Key: bucketKey
                                     }, function (err, data) {
                                         if (err) {
                                             consoleWithMessage(`${opName}-UpdateFunctionCode`, `${CERROR}(ERROR)${CRESET} ${err}`);
                                             reject(err)
                                         } else {
                                             adaptor.waitFor('functionUpdated', { FunctionName: data.FunctionArn }, function(err, data) {
                                                if (err) {
                                                    reject(err);
                                                } else {
                                                     consoleWithMessage(`${opName}-UpdateFunctionCode`, `${CDONE}(OK)${CRESET}`);
                                                     resolve(data)
                                                }
                                             });
                                         }
                                     });
                                }
                            });
                        }
                    });
                } else {
                    var index = 0
                    function retryCreateFunction() {
                        consoleWithMessage(`${opName}-CreateFunction`, `${functionConfig.FunctionName.truncate(50)}`);
                        adaptor.createFunction(params, function (err, data) {
                            if (++index > creationTimeout) {
                                reject(`Create Function Timeout with (Error): ${err}`)
                            } else if (!err) {
                                resolve({ ...data });
                                adaptor.waitFor('functionActive', { FunctionName: data.FunctionArn }, function(err, data) {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        consoleWithMessage(`${opName}-CreateFunction`, `${CDONE}(OK)${CRESET}`);
                                        resolve(data)
                                    }
                                });
                            } else {
                                setTimeout(() => retryCreateFunction(), 1000)
                            }
                        })
                    }
                    retryCreateFunction()
                }
            } else {
                adaptor.waitFor('functionActive', { FunctionName: data.FunctionArn }, function(err, data) {
                    if (err) {
                        reject(err);
                    } else {
                        consoleWithMessage(`${opName}-CreateFunction`, `${CDONE}(OK)${CRESET}`);
                        resolve(data)
                    }
                });
            }
        })
    })
}

const updateFunctionConfiguration = function (options) {
    var { adaptor, opName, functionConfig } = options
    opName = opName || `updateFunctionConfiguration`
    return new Promise(function (resolve, reject) {
        const unusedProps = ["Code", "Publish", "Tags"]
        unusedProps.forEach(function (k) { delete functionConfig[k] })
        adaptor.waitFor('functionActive', { FunctionName: data.FunctionArn }, function(err, data) {
            if (err) {
                reject(err);
            } else {
                adaptor.updateFunctionConfiguration({ ...functionConfig }, function (err, data) {
                    if (err) {
                        consoleWithMessage(`${opName}-UpdateFunctionConfig`, `${CERROR}(ERROR)${CRESET} ${err}`);
                        reject(err)
                    } else {
                        adaptor.waitFor('functionUpdated', { FunctionName: data.FunctionArn }, function(err, data) {
                            if (err) {
                                reject(err);
                            } else {
                                consoleWithMessage(`${opName}-UpdateFunctionConfig`, `${CDONE}(OK)${CRESET}`);
                                resolve(data)
                            }
                        });
                    }
                })
            }
        });
    })
}

const getFunctionConfiguration = function (options) {
    var { adaptor, opName, functionConfig } = options
    opName = opName || `getFunctionConfiguration`
    return new Promise(function (resolve, reject) {
        adaptor.getFunctionConfiguration({
            FunctionName: functionConfig.FunctionName,
            Qualifier: functionConfig.Qualifier
        }, function (err, functionData) {
            err ? reject(err) : resolve(functionData)
        })
    })
}

const publishFunctionVersion = function (options) {
    var { adaptor, opName, functionConfig, functionMeta } = options
    opName = opName || `publishFunctionVersion`
    return new Promise(function (resolve, reject) {
        adaptor.publishVersion({
            FunctionName: functionConfig.FunctionName,
            CodeSha256: functionMeta.data.CodeSha256,
            RevisionId: functionMeta.data.RevisionId
        }, function (err, functionVersion) {
            err ? reject(err) : resolve(functionVersion)
        })
    })
}

const createFunctionLayerVersion = function (options) {
    var { adaptor, opName, bucketName, bucketKey, functionConfig, layerConfig } = options
    opName = opName || `createFunctionLayerVersion`
    return new Promise(function (resolve, reject) {
        var params = {
            Content: {
                S3Bucket: bucketName,
                S3Key: bucketKey
            },
            ...layerConfig
        };
        consoleWithMessage(`${opName}-CreateFunctionLayer`, `${layerConfig.LayerName}`);
        adaptor.publishLayerVersion(params, function (err, data) {
            if (err) {
                consoleWithMessage(`${opName}-CreateLayerVersion`, `${CERROR}(ERROR)${CRESET} ${err}`);
                reject(err)
            } else {
                if (!functionConfig.Layers) functionConfig.Layers = []
                let layerIndex = -1
                let existedLayerArn = functionConfig.Layers.find(function (layerArn, index) {
                    layerIndex = index
                    const multiPartsLayerArn = layerArn.split(':')
                    return (multiPartsLayerArn.length > 6 && multiPartsLayerArn[6] === layerConfig.LayerName)
                })
                if (typeof existedLayerArn !== 'undefined') {
                    functionConfig.Layers[layerIndex] = data.LayerVersionArn
                } else {
                    functionConfig.Layers.push(data.LayerVersionArn)
                }
                data.Layers = functionConfig.Layers
                let listFunctionNames = []
                let indexFunctionName = 0
                if (Array.isArray(functionConfig.FunctionName)) {
                    listFunctionNames = functionConfig.FunctionName
                } else {
                    listFunctionNames.push(functionConfig.FunctionName)
                }
                listFunctionNames.map(functionName => {
                    adaptor.updateFunctionConfiguration({
                        FunctionName: functionName,
                        Layers: functionConfig.Layers,
                        Environment: functionConfig.Environment
                    }, function (err, _) {
                        if (err) {
                            consoleWithMessage(`${opName}-UpdateFunctionConfig`, `${functionName} ${CERROR}(ERROR)${CRESET} ${err}`);
                        } else {
                            consoleWithMessage(`${opName}-UpdateFunctionConfig`, `${functionName} ${CDONE}(OK)${CRESET}`);
                        }
                        if (++indexFunctionName >= listFunctionNames.length) {
                            err ? reject(err) : resolve(data)
                        }
                    })
                })
            }
        });
    })
}

const getFunctionMetaInfos = function (options) {
    var { adaptor, logger, opName, functionConfig, silentIs } = options
    opName = opName || `getFunctionMetaInfos`
    return new Promise(function (resolve, reject) {
        var params = {
            FunctionName: functionConfig.FunctionName,
            Qualifier: functionConfig.Qualifier
        };
        consoleWithMessage(`${opName}-GetFunction`, `${functionConfig.FunctionName.truncate(50)}`, silentIs);
        adaptor.getFunction(params, function (err, data) {
            if (err) {
                consoleWithMessage(`${opName}-GetFunction`, `${CERROR}(ERROR)${CRESET} ${err}`, silentIs);
                reject(err)
            } else {
                let layerIndex = 0
                let functionData = { ...data, LayerInfos: [] }
                functionData.Configuration.Layers = functionData.Configuration.Layers || []
                consoleWithMessage(`${opName}-GetFunctionLayers`, `${functionConfig.FunctionName.truncate(50)}`, silentIs);
                if (typeof logger !== 'undefined') {
                    logger.describeLogGroups({ logGroupNamePrefix: `/aws/lambda/${functionConfig.FunctionName}` }, function (err, data) {
                        if (err) reject(err)
                        else {
                            functionData.LogGroup = data.logGroups.find(g => g.logGroupName === `/aws/lambda/${functionConfig.FunctionName}`)
                            if (functionData.Configuration.Layers.length > 0) {
                                getLayerInfoRecusive(layerIndex)
                            } else {
                                resolve(functionData)
                            }
                        }
                    });
                } else {
                    if (functionData.Configuration.Layers.length > 0) {
                        getLayerInfoRecusive(layerIndex)
                    } else {
                        resolve(functionData)
                    }
                }
                function getLayerInfoRecusive(index) {
                    const layerArnWithVersion = functionData.Configuration.Layers[index].Arn.split(':')
                    const layerOnlyARN = layerArnWithVersion.splice(0, layerArnWithVersion.length - 1).join(':')
                    const versionNumber = layerArnWithVersion.join('')
                    adaptor.getLayerVersion({
                        LayerName: layerOnlyARN,
                        VersionNumber: versionNumber
                    }, function (err, layerMeta) {
                        if (err) {
                            reject(err)
                        } else {
                            if (++index < functionData.Configuration.Layers.length) {
                                functionData.LayerInfos.push(layerMeta)
                                getLayerInfoRecusive(index)
                            } else {
                                functionData.LayerInfos.push(layerMeta)
                                resolve(functionData)
                            }
                        }
                    });
                }
            }
        });
    })
}

const updateAPIGatewayDeployment = function (options) {
    var { adaptor, opName, apiConfig } = options
    opName = opName || `updateAPIGatewayDeployment`
    return new Promise(function (resolve, reject) {
        consoleWithMessage(`${opName}-CreateDeployment`, `${apiConfig.GatewayId}`);
        adaptor.createDeployment({
            stageName: apiConfig.StageName,
            restApiId: apiConfig.GatewayId
        }, function (err, data) {
            if (err) {
                consoleWithMessage(`${opName}-CreateDeployment`, `${CERROR}(ERROR)${CRESET} ${err}`);
                reject(err)
            } else {
                adaptor.updateStage({
                    stageName: apiConfig.StageName,
                    restApiId: apiConfig.GatewayId,
                    patchOperations: [{ op: 'replace', path: '/deploymentId', value: data.id }]
                }, function (err, data) {
                    if (err) {
                        consoleWithMessage(`${opName}-UpdateDeploymentStage`, `${CERROR}(ERROR)${CRESET} ${err}`);
                        reject(err)
                    } else {
                        consoleWithMessage(`${opName}-UpdateDeploymentStage`, `${CDONE}(OK)${CRESET}`);
                        resolve(data)
                    }
                });
            }
        })
    })
}

const createOrUpdateStackOnComplete = function (options) {
    return new Promise(function (resolve, reject) {
        var { adaptor, opName, stackName } = options
        const internvalTime = process.env.SIMPLIFY_STACK_INTERVAL || 5000
        var poolingTimeout = process.env.SIMPLIFY_STACK_TIMEOUT || 360
        const timeoutInMinutes = poolingTimeout * internvalTime
        opName = opName || `createOrUpdateStackOnComplete`
        createOrUpdateStack(options).then(function (data) {
            consoleWithMessage(`${opName}-CreateStackOrUpdate`, `Creating ${(data.StackName || data.StackId).truncate(50)}`);
            const whileStatusIsPending = function () {
                checkStackStatusOnComplete(options, data).then(function (data) {
                    if (typeof data.Error === "undefined") {
                        consoleWithMessage(`${opName}-CreateStackOrUpdate`, `${CDONE}(${data.StackName})${CRESET} ${data.StackStatus}`);
                        if (data.StackStatus == "DELETE_COMPLETE" || data.StackStatus == "DELETE_FAILED" ||
                            data.StackStatus == "ROLLBACK_COMPLETE" || data.StackStatus == "ROLLBACK_FAILED" ||
                            data.StackStatus == "CLEANUP_COMPLETE" || data.StackStatus == "UPDATE_FAILED") {
                            reject(data)
                        } else {
                            resolve(data)
                        }
                    } else {
                        consoleWithMessage(`${opName}-CreateStackOrUpdate`, `(${(data.StackName || data.StackId).truncate(50)}) ${data.StackStatus}`);
                        reject(data.Error)
                    }
                }, function (stackObject) {
                    consoleWithMessage(`${opName}-CreateStackOrUpdate`, `(${options.stackName}) ${stackObject.StackStatus}`);
                    setTimeout(whileStatusIsPending, internvalTime);
                    if (--poolingTimeout <= 0) {
                        reject({ message: `Operation Timeout: Running over ${timeoutInMinutes} mins` })
                    }
                })
            }
            setTimeout(whileStatusIsPending, internvalTime);
        }, function (err) {
            if (err.code == "ValidationError" && err.message.startsWith("No updates are to be performed.")) {
                adaptor.describeStacks({
                    StackName: stackName
                }, function (err, data) {
                    err ? reject(err) : resolve(data.Stacks[0])
                })
            } else {
                consoleWithMessage(`${opName}-CreateStackOrUpdate`, `(${options.stackName}) ${CERROR}(ERROR)${CRESET} ${err}`);
                reject(err)
            }
        })
    })
}

const deleteStackOnComplete = function (options) {
    return new Promise(function (resolve, reject) {
        var { opName } = options
        const internvalTime = process.env.SIMPLIFY_STACK_INTERVAL || 5000
        var poolingTimeout = process.env.SIMPLIFY_STACK_TIMEOUT || 360
        const timeoutInMinutes = poolingTimeout * internvalTime
        opName = opName || `deleteStackOnComplete`
        deleteExistingStack(options).then(function (data) {
            consoleWithMessage(`${opName}-DeleteExistingStack`, `Deleting ${options.stackName}`);
            const whileStatusIsPending = function () {
                data.StackName = data.StackName || options.stackName
                checkStackStatusOnComplete(options, data).then(function (data) {
                    if (typeof data.Error === "undefined") {
                        consoleWithMessage(`${opName}-DeleteExistingStack`, `${CDONE}(OK)${CRESET} with ${data.StackStatus}`);
                        if (data.StackStatus == "DELETE_COMPLETE" || data.StackStatus == "DELETE_FAILED" ||
                            data.StackStatus == "ROLLBACK_COMPLETE" || data.StackStatus == "ROLLBACK_FAILED") {
                            reject(data)
                        } else {
                            resolve(data)
                        }
                    } else {
                        if (data.Error.code === "ValidationError") {
                            resolve({ RequestId: data.Error.requestId })
                        } else {
                            consoleWithMessage(`${opName}-DeleteExistingStack`, `(${options.stackName}) ${CERROR}(ERROR)${CRESET} ${data.Error}`);
                            reject(data.Error)
                        }
                    }
                }, function (stackObject) {
                    consoleWithMessage(`${opName}-DeleteExistingStack`, `(${options.stackName}) ${stackObject.StackStatus}`);
                    setTimeout(whileStatusIsPending, internvalTime);
                    if (--poolingTimeout <= 0) {
                        reject({ message: `Operation Timeout: Running over ${timeoutInMinutes} mins` })
                    }
                })
            }
            setTimeout(whileStatusIsPending, internvalTime);
        }, function (err) {
            consoleWithMessage(`${opName}-DeleteExistingStack`, `(${options.stackName}) ${CERROR}(ERROR)${CRESET} ${err}`);
            reject(err)
        })
    })
}

const deleteFunctionLayerVersions = function (options) {
    var { adaptor, opName, functionConfig } = options
    opName = opName || `deleteFunctionLayerVersions`
    return new Promise(function (resolve, reject) {
        let layerDeletionIndex = 0
        functionConfig.Layers = functionConfig.Layers || resolve([])
        functionConfig.Layers.forEach(function (layer) {
            const layerArnWithVersion = layer.split(':')
            const layerOnlyARN = layerArnWithVersion.splice(0, layerArnWithVersion.length - 1).join(':')
            consoleWithMessage(`${opName}-ListLayerVersions`, `${layerOnlyARN.truncate(50)}`);
            adaptor.listLayerVersions({ LayerName: layerOnlyARN }, function (err, data) {
                let layerVersionIndex = 0
                function deleteOneLayerVersion(index) {
                    const layerVersionNumber = data.LayerVersions[index].Version
                    adaptor.deleteLayerVersion({ LayerName: layerOnlyARN, VersionNumber: layerVersionNumber }, function (err) {
                        if (err) {
                            consoleWithMessage(`${opName}-DeleteLayerVersion`, `${CERROR}(ERROR)${CRESET} ${err}`);
                        } else if (++index < data.LayerVersions.length) {
                            consoleWithMessage(`${opName}-DeleteLayerVersion`, `${CDONE}(OK)${CRESET} ${layerOnlyARN.truncate(50)}:${layerVersionNumber}`);
                            deleteOneLayerVersion(index)
                        } else {
                            consoleWithMessage(`${opName}-DeleteLayerVersion`, `${CDONE}(OK)${CRESET} ${layerOnlyARN.truncate(50)}:${layerVersionNumber}`);
                            if (++layerDeletionIndex >= functionConfig.Layers.length) {
                                resolve(functionConfig.Layers)
                            }
                        }
                    })
                }
                if (err) {
                    consoleWithMessage(`${opName}-ListLayerVersions`, `${CERROR}(ERROR)${CRESET} ${err}`);
                    reject(err)
                } else if (data.LayerVersions.length > 0) {
                    deleteOneLayerVersion(layerVersionIndex)
                }
            })
        })
    })
}

const deleteFunction = function (options) {
    var { adaptor, opName, functionConfig, withLayerVersions } = options
    opName = opName || `deleteFunction`
    return new Promise(function (resolve, reject) {
        consoleWithMessage(`${opName}-DeleteFunction`, `${functionConfig.FunctionName.truncate(50)}`);
        adaptor.deleteFunction({
            FunctionName: functionConfig.FunctionName
        }, function (err) {
            err ? reject(err) : withLayerVersions ? deleteFunctionLayerVersions(options).then(_ => resolve(functionConfig)).catch(err => reject(err)) : resolve(functionConfig)
        })
    })
}

const emptyBucketForDeletion = function (options) {
    var { adaptor, opName, bucketName } = options
    opName = opName || `emptyBucketForDeletion`
    return new Promise(function (resolve, reject) {
        adaptor.listObjects({
            Bucket: bucketName
        }, function (err, data) {
            if (err) reject(err)
            else {
                let dataIndex = 0
                data.Contents.forEach(function (content) {
                    adaptor.deleteObject({
                        Bucket: bucketName,
                        Key: content.Key
                    }, function (err, _) {
                        if (++dataIndex >= data.Contents.length) {
                            resolve(data.Contents)
                        }
                    })
                })
            }
        })
    })
}

const deleteStorageBucket = function (options) {
    var { adaptor, opName, bucketName } = options
    opName = opName || `deleteStorageBucket`
    return new Promise(function (resolve, reject) {
        adaptor.listObjects({ Bucket: bucketName }, function (err, data) {
            if (err) {
                consoleWithMessage(`${opName}-ListDeploymentObjects`, `${CERROR}(ERROR)${CRESET} ${err}`)
                reject(err)
            } else {
                const bucketKeys = data.Contents.map(function (content) {
                    return { Key: content.Key }
                })
                adaptor.deleteObjects({ Bucket: bucketName, Delete: { Objects: bucketKeys, Quiet: true } }, function (err) {
                    if (err) {
                        consoleWithMessage(`${opName}-DeleteDeploymentObjects`, `${CERROR}(ERROR)${CRESET} ${err}`)
                        reject(err)
                    } else {
                        adaptor.deleteBucket({ Bucket: bucketName }, function (err, data) {
                            if (err) {
                                consoleWithMessage(`${opName}-DeleteDeploymentBucket`, `${CERROR}(ERROR)${CRESET} ${err}`)
                                reject(err)
                            } else {
                                consoleWithMessage(`${opName}-DeleteDeploymentBucket`, `${CDONE}(OK)${CRESET} ${bucketName} was deleted!`)
                                resolve(data)
                            }
                        })
                    }
                })
            }
        })
    })
}

const setupKMSLogEncryption = function (options) {
    var { adaptor, logger, opName, functionInfo, enableOrDisable } = options
    opName = opName || `setupKMSLogEncryption`
    return new Promise(function (resolve, reject) {
        if (functionInfo.KMSKeyArn) {
            adaptor.getKeyPolicy({
                KeyId: functionInfo.KMSKeyArn,
                PolicyName: "default"
            }, function (err, policy) {
                if (err) reject(err);
                else {
                    let policyData = JSON.parse(policy.Policy);
                    let existedLogGroups = false
                    const newPolicy = enableOrDisable ? {
                        "Sid": `${functionInfo.FunctionName}-LogGroups-Permissions`,
                        "Effect": "Allow",
                        "Principal": {
                            "Service": logger.config.endpoint
                        },
                        "Action": [
                            "kms:Encrypt*",
                            "kms:Decrypt*",
                            "kms:ReEncrypt*",
                            "kms:GenerateDataKey*",
                            "kms:Describe*"
                        ],
                        "Resource": [
                            `${functionInfo.FunctionArn}`,
                            `${functionInfo.KMSKeyArn}`
                        ]
                    } : undefined
                    policyData.Statement = policyData.Statement.map(function (statement) {
                        if (statement && statement.Sid === `${functionInfo.FunctionName}-LogGroups-Permissions`) {
                            existedLogGroups = true
                            statement = newPolicy
                        }
                        return statement
                    }).filter(state => state)
                    if (!existedLogGroups && enableOrDisable) {
                        policyData.Statement.push(newPolicy)
                    } else if (existedLogGroups && !enableOrDisable) {
                        policyData.Statement = policyData.Statement.filter(function (statement) {
                            return statement.Sid !== `${functionInfo.FunctionName}-LogGroups-Permissions`
                        })
                    }
                    adaptor.putKeyPolicy({
                        KeyId: functionInfo.KMSKeyArn,
                        PolicyName: "default",
                        Policy: JSON.stringify(policyData)
                    }, function (err, _) {
                        if (err) reject(err);
                        else {
                            let params = {
                                logGroupName: `/aws/lambda/${functionInfo.FunctionName}`
                            };
                            let actionName = 'associateKmsKey'
                            if (!enableOrDisable /** disabled KMS */) {
                                actionName = 'disassociateKmsKey'
                            } else {
                                params.kmsKeyId = functionInfo.KMSKeyArn
                            }
                            logger[actionName](params, function (err, _) {
                                if (err) reject(err);
                                else {
                                    resolve(functionInfo)
                                }
                            })
                        }
                    })
                }
            })
        } else {
            let params = {
                logGroupName: `/aws/lambda/${functionInfo.FunctionName}`
            };
            let actionName = 'associateKmsKey'
            if (!enableOrDisable /** disabled KMS */) {
                actionName = 'disassociateKmsKey'
                logger[actionName](params, function (err, _) {
                    if (err) reject(err);
                    else {
                        resolve(functionInfo)
                    }
                })
            } else {
                reject(`Missing required key 'KMSKeyId' in function csv file`)
            }
        }
    })
}

const enableOrDisableLogEncryption = function (options) {
    var { logger, opName, functionInfo, retentionInDays } = options
    opName = opName || `enableOrDisableLogEncryption`
    return new Promise(function (resolve, reject) {
        if (typeof retentionInDays !== 'undefined') {
            logger.putRetentionPolicy({
                logGroupName: `/aws/lambda/${functionInfo.FunctionName}`,
                retentionInDays: retentionInDays
            }, function (err, _) {
                if (err) reject(err);
                else {
                    setupKMSLogEncryption(options).then(data => resolve(data)).catch(err => reject(err))
                }
            })
        } else {
            resolve({})
        }
    })
}

const getFunctionMetricStatistics = function (options) {
    const { adaptor, functions, metricName, periods, startDate, endDate } = options
    let defaultDate = new Date()
    defaultDate.setHours(defaultDate.getHours() - 6)
    return new Promise((resolve, reject) => {
        let params = {
            EndTime: endDate || new Date(),
            MetricName: metricName || 'Invocations', /* Duration - Invocations - Throttles - Errors - ConcurrentExecutions */
            Namespace: 'AWS/Lambda', /* required */
            Period: periods || 10, /* 12 x (5 minutes) */
            StartTime: startDate || defaultDate,
            Dimensions: functions.map(func => {
                return {
                    Name: 'FunctionName',
                    Value: `${func.FunctionName}`
                }
            }),
            Statistics: [
                "SampleCount",
                "Average",
                "Sum",
                "Minimum",
                "Maximum",
                /* more items */
            ]
        };
        adaptor.getMetricStatistics(params, function (err, data) {
            err ? reject(err) : resolve(data)
        });
    })
}

const getFunctionMetricData = function (options) {
    const { adaptor, functions, periods, startDate, endDate } = options
    let defaultDate = new Date()
    defaultDate.setHours(defaultDate.getHours() - 3)
    let metricDataQueries = []
    functions.map((func, idx) => {
        const functionId = idx
        metricDataQueries.push(
            {
                Id: `invocations_${functionId}`,
                Label: `Invocations`,
                MetricStat: {
                    Metric: { /* required */
                        Dimensions: [{
                            Name: 'FunctionName',
                            Value: `${func.FunctionName}`
                        }],
                        MetricName: 'Invocations', /* Duration - Invocations - Throttles - Errors - ConcurrentExecutions */
                        Namespace: 'AWS/Lambda', /* required */
                    },
                    Period: periods || 300,
                    Stat: 'Sum'
                },
                ReturnData: true
            })
        metricDataQueries.push({
            Id: `errors_${functionId}`,
            Label: `Errors`,
            MetricStat: {
                Metric: { /* required */
                    Dimensions: [{
                        Name: 'FunctionName',
                        Value: `${func.FunctionName}`
                    }],
                    MetricName: 'Errors', /* Duration - Invocations - Throttles - Errors - ConcurrentExecutions */
                    Namespace: 'AWS/Lambda', /* required */
                },
                Period: periods || 300,
                Stat: 'Sum'
            },
            ReturnData: true
        })
        metricDataQueries.push({
            Id: `duration_${functionId}`,
            Label: `Duration`,
            MetricStat: {
                Metric: { /* required */
                    Dimensions: [{
                        Name: 'FunctionName',
                        Value: `${func.FunctionName}`
                    }],
                    MetricName: 'Duration', /* Duration - Invocations - Throttles - Errors - ConcurrentExecutions */
                    Namespace: 'AWS/Lambda', /* required */
                },
                Period: periods || 300,
                Stat: 'Average'
            },
            ReturnData: true
        })
        metricDataQueries.push({
            Id: `concurrent_${functionId}`,
            Label: `Concurrency`,
            MetricStat: {
                Metric: { /* required */
                    Dimensions: [{
                        Name: 'FunctionName',
                        Value: `${func.FunctionName}`
                    }],
                    MetricName: 'ConcurrentExecutions', /* Duration - Invocations - Throttles - Errors - ConcurrentExecutions */
                    Namespace: 'AWS/Lambda', /* required */
                },
                Period: periods || 300,
                Stat: 'Sum'
            },
            ReturnData: true
        })
        metricDataQueries.push({
            Id: `throttle_${functionId}`,
            Label: `Throttles`,
            MetricStat: {
                Metric: { /* required */
                    Dimensions: [{
                        Name: 'FunctionName',
                        Value: `${func.FunctionName}`
                    }],
                    MetricName: 'Throttles', /* Duration - Invocations - Throttles - Errors - ConcurrentExecutions */
                    Namespace: 'AWS/Lambda', /* required */
                },
                Period: periods || 300,
                Stat: 'Sum'
            },
            ReturnData: true
        })
    })
    return new Promise((resolve, reject) => {
        let params = {
            StartTime: startDate || defaultDate,
            EndTime: endDate || new Date(),
            MetricDataQueries: metricDataQueries
        }
        adaptor.getMetricData(params, function (err, data) {
            err ? reject(err) : resolve(data)
        });
    })
}

const finishWithErrors = function (opName, err) {
    opName = `${CBEGIN}Simplify${CRESET} | ${opName}` || `${CBEGIN}Simplify${CRESET} | unknownOperation`
    console.error(`${opName}: \n - ${CERROR}${err}${CRESET} \n`)
    process.exit(255)
}

const finishWithSuccess = function (message) {
    console.log(`\n * ${message.truncate(150)} \n`)
}

const finishWithMessage = function (opName, message) {
    opName = `${CBEGIN}FINISH${CRESET} | ${opName}` || `${CBEGIN}FINISH${CRESET} | unknownOperation`
    console.log(`\n * ${opName + ':' || ''} ${message.truncate(100)} \n`)
}

var spinnerChars = ['|', '/', '-', '\\'];
var spinnerIndex = 0;
const silentWithSpinner = function () {
    spinnerIndex = (spinnerIndex > 3) ? 0 : spinnerIndex;
    process.stdout.write("\r" + spinnerChars[spinnerIndex++]);
}

const consoleWithMessage = function (opName, message, silent) {
    opName = `${CBEGIN}Simplify${CRESET} | ${opName}` || `${CBEGIN}Simplify${CRESET} | unknownOperation`
    !silent ? process.stdout.write("\r") && console.log(`${opName}:`, `${message.truncate(150)}`) : silentWithSpinner()
}

const consoleWithErrors = function (opName, error, silent) {
    opName = `${CBEGIN}Simplify${CRESET} | ${opName}` || `${CBEGIN}Simplify${CRESET} | unknownOperation`
    !silent ? process.stdout.write("\r") && console.log(`${opName}:`, `${CNOTIF}${(error.message || error).truncate(150)}${CRESET}`) : silentWithSpinner()
}

const deleteDeploymentBucket = deleteStorageBucket

module.exports = {
    showBoxBanner,
    getContentArgs,
    getContentFile,
    getInputConfig,
    uploadLocalFile,
    getFunctionSha256,
    uploadLocalDirectory,
    uploadDirectoryAsZip,
    createOrUpdateStack,
    deleteStackOnComplete,
    emptyBucketForDeletion,
    deleteDeploymentBucket,
    deleteStorageBucket,
    deleteFunctionLayerVersions,
    createFunctionLayerVersion,
    updateFunctionConfiguration,
    getFunctionConfiguration,
    getFunctionMetricStatistics,
    getFunctionMetricData,
    publishFunctionVersion,
    updateFunctionRolePolicy,
    deleteFunctionRolePolicy,
    createOrUpdateFunctionRole,
    deleteFunctionRole,
    checkStackStatusOnComplete,
    createOrUpdateFunction,
    deleteFunction,
    createOrUpdateStackOnComplete,
    enableOrDisableLogEncryption,
    updateAPIGatewayDeployment,
    getFunctionMetaInfos,
    consoleWithMessage,
    consoleWithErrors,
    finishWithMessage,
    finishWithSuccess,
    finishWithErrors
}

process.env.DISABLE_BOX_BANNER || showBoxBanner()
