#!/usr/bin/env node
'use strict';
const path = require('path')
const crypto = require('crypto')
const fs = require('fs')
const AdmZip = require('adm-zip')
const utilities = require('./utilities')
const CBEGIN = '\x1b[32m'
const CERROR = '\x1b[31m'
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
 */

const showBoxBanner = function () {
    console.log("╓───────────────────────────────────────────────────────────────╖")
    console.log("║               Simplify Framework - DevSecOps                  ║")
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

const parseTemplate = function (...args) {
    var template = args.shift()
    function parseVariables(v) {
        Object.keys(process.env).map(function (e) {
            v = v.replace(new RegExp('\\${' + e + '}', 'g'), process.env[e])
        })
        args.forEach(function (a) {
            if (typeof a === 'object') {
                Object.keys(a).map(function (i) {
                    v = v.replace(new RegExp('\\${' + i + '}', 'g'), a[i])
                })
            }
        })
        return v.replace(/\${DATE_TODAY}/g, utilities.getDateToday()).replace(/\${TIME_MOMENT}/g, utilities.getTimeMoment())
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
    return parseTemplate(config, ...args)
}

const createOrUpdateStack = function (options) {
    var { adaptor, opName, stackName, stackParameters, stackTemplate } = options
    opName = opName || `${CBEGIN}Simplify${CRESET} | createOrUpdateStack`
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
    opName = opName || `${CBEGIN}Simplify${CRESET} | deleteExistingStack`
    return new Promise(function (resolve, reject) {
        var params = {
            StackName: stackName
        };
        adaptor.deleteStack(params, function (err, data) {
            err ? reject(err) : resolve(data)
        });
    })
}

const checkStackStatusOnComplete = function (options, stackData) {
    var { adaptor, opName } = options
    opName = opName || `${CBEGIN}Simplify${CRESET} | checkStackStatusOnComplete`
    return new Promise(function (resolve, reject) {
        var params = {
            StackName: stackData.StackId || stackData.StackName
        };
        adaptor.describeStacks(params, function (err, data) {
            if (err) resolve({ Error: err }); // resolve to FINISH in case there was an error
            else {
                var currentStack = data.Stacks.length > 0 ? data.Stacks[0] : stackData
                if (data.Stacks.length && (
                    currentStack.StackStatus == "UPDATE_COMPLETE" ||
                    currentStack.StackStatus == "UPDATE_ROLLBACK_COMPLETE" ||
                    currentStack.StackStatus == "CREATE_COMPLETE" ||
                    currentStack.StackStatus == "ROLLBACK_COMPLETE" ||
                    currentStack.StackStatus == "ROLLBACK_FAILED" ||
                    currentStack.StackStatus == "DELETE_COMPLETE" ||
                    currentStack.StackStatus == "DELETE_FAILED"
                )) {
                    resolve(currentStack) // resolve to FINISH in case there was a matched STATUS found
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
    var { adaptor, opName, bucketKey, inputDirectory } = options
    opName = opName || `${CBEGIN}Simplify${CRESET} | uploadLocalDirectory`
    return new Promise(function (resolve, reject) {
        adaptor.createBucket(function (err) {
            if (!err || (err.code == 'BucketAlreadyOwnedByYou')) {
                fs.readdir(inputDirectory, function (err, files) {
                    if (err) reject(err)
                    else {
                        var index = 0
                        var fileInfos = []
                        files.forEach(function (fileName) {
                            var filePath = path.resolve(path.join(inputDirectory, fileName))
                            fs.readFile(filePath, function (err, data) {
                                if (err) reject(err)
                                else {
                                    var params = {
                                        Key: bucketKey + '/' + fileName,
                                        Body: data
                                    };
                                    adaptor.upload(params, function (err, data) {
                                        if (err) {
                                            consoleWithMessage(`${opName}`, `FileUpload: ${CERROR}(ERROR)${CRESET} ${err}`)
                                            reject(err)
                                        } else {
                                            fileInfos.push(data)
                                            consoleWithMessage(`${opName}`, `FileUpload: ${params.Key}`)
                                            if (++index >= files.length) {
                                                resolve(fileInfos)
                                            }
                                        }
                                    });
                                }
                            });
                        })
                    }
                })
            } else {
                if (err.code == 'BucketAlreadyExists') {
                    consoleWithMessage(`${opName}`, `CreateBucket: ${CERROR}(ERROR)${CRESET} ${err} *** It has been created by another AWS Account worldwide!`)
                } else {
                    consoleWithMessage(`${opName}`, `CreateBucket: ${CERROR}(ERROR)${CRESET} ${err}`)
                }
                reject(err)
            }
        })
    })
}

const uploadLocalFile = function (options) {
    var { adaptor, opName, bucketKey, inputLocalFile } = options
    opName = opName || `${CBEGIN}Simplify${CRESET} | uploadLocalFile`
    var uploadFileName = path.basename(inputLocalFile)
    return new Promise(function (resolve, reject) {
        try {
            consoleWithMessage(`${opName}`, `ReadFile: ${inputLocalFile.truncate(50)}`)
            fs.readFile(inputLocalFile, function (err, data) {
                if (err) throw err;
                adaptor.createBucket(function (err) {
                    var params = {
                        Key: bucketKey + '/' + uploadFileName,
                        Body: data
                    };
                    if (!err || (err.code == 'BucketAlreadyOwnedByYou')) {
                        adaptor.upload(params, function (err, data) {
                            if (err) {
                                consoleWithMessage(`${opName}`, `FileUpload: ${CERROR}(ERROR)${CRESET} ${err}`)
                                reject(err)
                            } else {
                                consoleWithMessage(`${opName}`, `FileUpload: ${data.Location.truncate(50)}`)
                                resolve({ ...data })
                            }
                        });
                    } else {
                        consoleWithMessage(`${opName}`, `CreateBucket: ${CERROR}(ERROR)${CRESET} ${err}`)
                        reject(err)
                    }
                });
            });
        } catch (err) {
            reject(err)
        }
    })
}

const uploadDirectoryAsZip = function (options) {
    var { adaptor, opName, bucketKey, inputDirectory, outputFilePath, hashInfo, fileName } = options
    opName = opName || `${CBEGIN}Simplify${CRESET} | uploadDirectoryAsZip`
    var outputZippedFile = `${fileName || utilities.toDateString()}.zip`
    var outputZippedFilePath = path.join(outputFilePath, outputZippedFile)
    return new Promise(function (resolve, reject) {
        try {
            const zip = new AdmZip();
            zip.addLocalFolder(inputDirectory)
            zip.writeZip(outputZippedFilePath)
            consoleWithMessage(`${opName}`, `ZipFile: ${outputZippedFilePath.truncate(50)}`)
            const zipBuffer = Buffer.concat(zip.getEntries().map(e => {
                return e.getData()
            }))
            const sha256Hex = crypto.createHash('sha256').update(zipBuffer).digest('hex')
            if (sha256Hex === hashInfo.FileSha256) {
                resolve(hashInfo)
            } else {
                uploadLocalFile({ adaptor, opName, bucketKey, inputLocalFile: outputZippedFilePath }).then(function (data) {
                    resolve({ ...data, FileSha256: sha256Hex })
                }).catch(function (err) { reject(err) })
            }
        } catch (err) {
            consoleWithMessage(`${opName}`, `ZipFile: ${CERROR}(ERROR)${CRESET} ${err}`);
            reject(err)
        }
    })
}

const createOrUpdateFunction = function (options) {
    var { adaptor, opName, bucketName, bucketKey, functionConfig } = options
    opName = opName || `${CBEGIN}Simplify${CRESET} | createOrUpdateFunction`
    return new Promise(function (resolve, reject) {
        var params = {
            Code: {
                S3Bucket: bucketName,
                S3Key: bucketKey
            },
            ...functionConfig
        };
        consoleWithMessage(`${opName}`, `CreateFunction: ${functionConfig.FunctionName.truncate(50)}`);
        adaptor.createFunction(params, function (err) {
            if (err) {
                consoleWithMessage(`${opName}`, `UpdateFunctionConfig: ${functionConfig.FunctionName.truncate(50)}`);
                const unusedProps = ["Code", "Publish", "Tags"]
                unusedProps.forEach(function (k) { delete params[k] })
                adaptor.updateFunctionConfiguration(params, function (err) {
                    if (err) {
                        reject(err)
                    } else {
                        consoleWithMessage(`${opName}`, `UpdateFunctionConfig: ${CDONE}(OK)${CRESET}`);
                        adaptor.updateFunctionCode({
                            FunctionName: functionConfig.FunctionName,
                            S3Bucket: bucketName,
                            S3Key: bucketKey
                        }, function (err, data) {
                            if (err) {
                                consoleWithMessage(`${opName}`, `UpdateFunctionCode: ${CERROR}(ERROR)${CRESET} ${err}`);
                                reject(err)
                            } else {
                                consoleWithMessage(`${opName}`, `UpdateFunctionCode: ${CDONE}(OK)${CRESET}`);
                                resolve(data)
                            }
                        })
                    }
                });
            } else {
                consoleWithMessage(`${opName}`, `CreateFunction: ${CDONE}(OK)${CRESET}`);
                adaptor.updateFunctionCode({
                    FunctionName: functionName,
                    S3Bucket: bucketName,
                    S3Key: bucketKey
                }, function (err, data) {
                    if (err) {
                        consoleWithMessage(`${opName}`, `UpdateFunctionCode: ${CERROR}(ERROR)${CRESET} ${err}`);
                        reject(err)
                    } else {
                        consoleWithMessage(`${opName}`, `UpdateFunctionCode: ${CDONE}(OK)${CRESET}`);
                        resolve(data)
                    }
                })
            }
        });
    })
}

const updateFunctionConfiguration = function (options) {
    var { adaptor, opName, functionConfig } = options
    opName = opName || `${CBEGIN}Simplify${CRESET} | updateFunctionConfiguration`
    return new Promise(function (resolve, reject) {
        const unusedProps = ["Code", "Publish", "Tags"]
        unusedProps.forEach(function (k) { delete functionConfig[k] })
        adaptor.updateFunctionConfiguration({ ...functionConfig }, function (err, data) {
            if (err) {
                consoleWithMessage(`${opName}`, `UpdateFunctionConfig: ${CERROR}(ERROR)${CRESET} ${err}`);
                reject(err)
            } else {
                consoleWithMessage(`${opName}`, `UpdateFunctionConfig: ${CDONE}(OK)${CRESET}`);
                resolve(data)
            }
        })
    })
}

const getFunctionConfiguration = function (options) {
    var { adaptor, opName, functionConfig } = options
    opName = opName || `${CBEGIN}Simplify${CRESET} | getFunctionConfiguration`
    return new Promise(function (resolve, reject) {
        adaptor.getFunctionConfiguration({
            FunctionName: functionConfig.FunctionName,
            Qualifier: functionConfig.Qualifier
        }, function (err, functionData) {
            err ? reject(err) : resolve(functionData)
        })
    })
}

const createFunctionLayerVersion = function (options) {
    var { adaptor, opName, bucketName, bucketKey, functionConfig, layerConfig } = options
    opName = opName || `${CBEGIN}Simplify${CRESET} | createFunctionLayerVersion`
    return new Promise(function (resolve, reject) {
        var params = {
            Content: {
                S3Bucket: bucketName,
                S3Key: bucketKey
            },
            ...layerConfig
        };
        consoleWithMessage(`${opName}`, `CreateFunctionLayer: ${layerConfig.LayerName}`);
        adaptor.publishLayerVersion(params, function (err, data) {
            if (err) {
                consoleWithMessage(`${opName}`, `CreateLayerVersion: ${CERROR}(ERROR)${CRESET} ${err}`);
                reject(err)
            } else {
                consoleWithMessage(`${opName}`, `UpdateFunctionConfig: ${layerConfig.LayerName}`);
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
                adaptor.updateFunctionConfiguration({
                    FunctionName: functionConfig.FunctionName,
                    Layers: functionConfig.Layers,
                    Environment: functionConfig.Environment
                }, function (err, _) {
                    if (err) {
                        consoleWithMessage(`${opName}`, `UpdateFunctionConfig: ${CERROR}(ERROR)${CRESET} ${err}`);
                        reject(err)
                    } else {
                        consoleWithMessage(`${opName}`, `UpdateFunctionConfig: ${CDONE}(OK)${CRESET}`);
                        resolve(data)
                    }
                })
            }
        });
    })
}

const getFunctionMetaInfos = function (options) {
    var { adaptor, logger, opName, functionConfig, silentIs } = options
    opName = opName || `${CBEGIN}Simplify${CRESET} | getFunctionMetaInfos`
    return new Promise(function (resolve, reject) {
        var params = {
            FunctionName: functionConfig.FunctionName,
            Qualifier: functionConfig.Qualifier
        };
        consoleWithMessage(`${opName}`, `GetFunction: ${functionConfig.FunctionName.truncate(50)}`, silentIs);
        adaptor.getFunction(params, function (err, data) {
            if (err) {
                consoleWithMessage(`${opName}`, `GetFunction: ${CERROR}(ERROR)${CRESET} ${err}`, silentIs);
                reject(err)
            } else {
                let layerIndex = 0
                let functionData = { ...data, LayerInfos: [] }
                functionData.Configuration.Layers = functionData.Configuration.Layers || []
                consoleWithMessage(`${opName}`, `GetFunctionLayers: ${functionConfig.FunctionName.truncate(50)}`, silentIs);
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
    opName = opName || `${CBEGIN}Simplify${CRESET} | updateAPIGatewayDeployment`
    return new Promise(function (resolve, reject) {
        consoleWithMessage(`${opName}`, `CreateDeployment: ${apiConfig.GatewayId}`);
        adaptor.createDeployment({
            stageName: apiConfig.StageName,
            restApiId: apiConfig.GatewayId
        }, function (err, data) {
            if (err) {
                consoleWithMessage(`${opName}`, `CreateDeployment: ${CERROR}(ERROR)${CRESET} ${err}`);
                reject(err)
            } else {
                adaptor.updateStage({
                    stageName: apiConfig.StageName,
                    restApiId: apiConfig.GatewayId,
                    patchOperations: [{ op: 'replace', path: '/deploymentId', value: data.id }]
                }, function (err, data) {
                    if (err) {
                        consoleWithMessage(`${opName}`, `UpdateDeploymentStage: ${CERROR}(ERROR)${CRESET} ${err}`);
                        reject(err)
                    } else {
                        consoleWithMessage(`${opName}`, `UpdateDeploymentStage: ${CDONE}(OK)${CRESET}`);
                        resolve(data)
                    }
                });
            }
        })
    })
}

const createOrUpdateStackOnComplete = function (options) {
    return new Promise(function (resolve, reject) {
        var { opName } = options
        const internvalTime = process.env.SIMPLIFY_STACK_INTERVAL || 5000
        var poolingTimeout = process.env.SIMPLIFY_STACK_TIMEOUT || 360
        const timeoutInMinutes = poolingTimeout * internvalTime
        opName = opName || `${CBEGIN}Simplify${CRESET} | createOrUpdateStackOnComplete`
        createOrUpdateStack(options).then(function (data) {
            consoleWithMessage(`${opName}`, `CreateStackOrUpdate: Creating ${(data.StackName || data.StackId).truncate(50)}`);
            const whileStatusIsPending = function () {
                checkStackStatusOnComplete(options, data).then(function (data) {
                    if (typeof data.Error === "undefined") {
                        consoleWithMessage(`${opName}`, `CreateStackOrUpdate: ${CDONE}(OK)${CRESET} with ${data.StackStatus}`);
                        if (data.StackStatus == "DELETE_COMPLETE" || data.StackStatus == "DELETE_FAILED" ||
                            data.StackStatus == "ROLLBACK_COMPLETE" || data.StackStatus == "ROLLBACK_FAILED" ||
                            data.StackStatus == "CLEANUP_COMPLETE") {
                            reject(data)
                        } else {
                            resolve(data)
                        }
                    } else {
                        consoleWithMessage(`${opName}`, `CreateStackOrUpdate: ${CERROR}(ERROR)${CRESET} ${data.Error}`);
                        reject(data.Error)
                    }
                }, function (stackObject) {
                    consoleWithMessage(`${opName}`, `CreateStackOrUpdate: ${stackObject.StackStatus} ${stackObject.StackStatusReason || ''}`);
                    setTimeout(whileStatusIsPending, internvalTime);
                    if (--poolingTimeout <= 0) {
                        reject({ message: `Operation Timeout: Running over ${timeoutInMinutes} mins` })
                    }
                })
            }
            setTimeout(whileStatusIsPending, internvalTime);
        }, function (err) {
            consoleWithMessage(`${opName}`, `CreateStackOrUpdate: ${CERROR}(ERROR)${CRESET} ${err}`);
            reject(err)
        })
    })
}

const deleteStackOnComplete = function (options) {
    return new Promise(function (resolve, reject) {
        var { opName } = options
        const internvalTime = process.env.SIMPLIFY_STACK_INTERVAL || 5000
        var poolingTimeout = process.env.SIMPLIFY_STACK_TIMEOUT || 360
        const timeoutInMinutes = poolingTimeout * internvalTime
        opName = opName || `${CBEGIN}Simplify${CRESET} | deleteStackOnComplete`
        deleteExistingStack(options).then(function (data) {
            consoleWithMessage(`${opName}`, `DeleteExistingStack: Deleting ${options.stackName}`);
            const whileStatusIsPending = function () {
                data.StackName = data.StackName || options.stackName
                checkStackStatusOnComplete(options, data).then(function (data) {
                    if (typeof data.Error === "undefined") {
                        consoleWithMessage(`${opName}`, `DeleteExistingStack: ${CDONE}(OK)${CRESET} with ${data.StackStatus}`);
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
                            consoleWithMessage(`${opName}`, `DeleteExistingStack: ${CERROR}(ERROR)${CRESET} ${data.Error}`);
                            reject(data.Error)
                        }
                    }
                }, function (stackObject) {
                    consoleWithMessage(`${opName}`, `DeleteExistingStack: ${stackObject.StackStatus} ${stackObject.StackStatusReason || ''}`);
                    setTimeout(whileStatusIsPending, internvalTime);
                    if (--poolingTimeout <= 0) {
                        reject({ message: `Operation Timeout: Running over ${timeoutInMinutes} mins` })
                    }
                })
            }
            setTimeout(whileStatusIsPending, internvalTime);
        }, function (err) {
            consoleWithMessage(`${opName}`, `DeleteExistingStack: ${CERROR}(ERROR)${CRESET} ${err}`);
            reject(err)
        })
    })
}

const deleteFunctionLayerVersions = function (options) {
    var { adaptor, opName, functionConfig } = options
    opName = opName || `${CBEGIN}Simplify${CRESET} | deleteFunctionLayerVersions`
    return new Promise(function (resolve, reject) {
        let layerDeletionIndex = 0
        functionConfig.Layers = functionConfig.Layers || []
        functionConfig.Layers.forEach(function (layer) {
            const layerArnWithVersion = layer.split(':')
            const layerOnlyARN = layerArnWithVersion.splice(0, layerArnWithVersion.length - 1).join(':')
            consoleWithMessage(`${opName}`, `ListLayerVersions: ${layerOnlyARN.truncate(50)}`);
            adaptor.listLayerVersions({ LayerName: layerOnlyARN }, function (err, data) {
                let layerVersionIndex = 0
                function deleteOneLayerVersion(index) {
                    const layerVersionNumber = data.LayerVersions[index].Version
                    adaptor.deleteLayerVersion({ LayerName: layerOnlyARN, VersionNumber: layerVersionNumber }, function (err) {
                        if (err) {
                            consoleWithMessage(`${opName}`, `DeleteLayerVersion: ${CERROR}(ERROR)${CRESET} ${err}`);
                        } else if (++index < data.LayerVersions.length) {
                            consoleWithMessage(`${opName}`, `DeleteLayerVersion: ${CDONE}(OK)${CRESET} ${layerOnlyARN.truncate(50)}:${layerVersionNumber}`);
                            deleteOneLayerVersion(index)
                        } else {
                            consoleWithMessage(`${opName}`, `DeleteLayerVersion: ${CDONE}(OK)${CRESET} ${layerOnlyARN.truncate(50)}:${layerVersionNumber}`);
                            if (++layerDeletionIndex >= functionConfig.Layers.length) {
                                resolve(functionConfig.Layers)
                            }
                        }
                    })
                }
                if (err) {
                    consoleWithMessage(`${opName}`, `ListLayerVersions: ${CERROR}(ERROR)${CRESET} ${err}`);
                    reject(err)
                } else if (data.LayerVersions.length > 0) {
                    deleteOneLayerVersion(layerVersionIndex)
                }
            })
        })
    })
}

const deleteDeploymentBucket = function (options) {
    var { adaptor, opName, bucketName } = options
    opName = opName || `${CBEGIN}Simplify${CRESET} | deleteDeploymentBucket`
    return new Promise(function (resolve, reject) {
        adaptor.listObjects({ Bucket: bucketName }, function (err, data) {
            if (err) {
                consoleWithMessage(`${opName}`, `ListDeploymentObjects: ${CERROR}(ERROR)${CRESET} ${err}`)
                reject(err)
            } else {
                const bucketKeys = data.Contents.map(function (content) {
                    return { Key: content.Key }
                })
                adaptor.deleteObjects({ Bucket: bucketName, Delete: { Objects: bucketKeys, Quiet: true } }, function (err) {
                    if (err) {
                        consoleWithMessage(`${opName}`, `DeleteDeploymentObjects: ${CERROR}(ERROR)${CRESET} ${err}`)
                        reject(err)
                    } else {
                        adaptor.deleteBucket({ Bucket: bucketName }, function (err, data) {
                            if (err) {
                                consoleWithMessage(`${opName}`, `DeleteDeploymentBucket: ${CERROR}(ERROR)${CRESET} ${err}`)
                                reject(err)
                            } else {
                                consoleWithMessage(`${opName}`, `DeleteDeploymentBucket: ${CDONE}(OK)${CRESET} ${bucketName} was deleted!`)
                                resolve(data)
                            }
                        })
                    }
                })
            }
        })
    })
}

const enableOrDisableLogEncryption = function (options) {
    var { adaptor, logger, opName, functionInfo, retentionInDays, enableOrDisable } = options
    opName = opName || `${CBEGIN}Simplify${CRESET} | enableLogEncryption`
    return new Promise(function (resolve, reject) {
        logger.putRetentionPolicy({
            logGroupName: `/aws/lambda/${functionInfo.FunctionName}`,
            retentionInDays: retentionInDays
        }, function (err, _) {
            if (err) reject(err);
            else if (functionInfo.KMSKeyArn) {
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
                resolve(functionInfo)
            }
        })
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
                Stat: 'Average'
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
    process.exit(0)
}

const finishWithMessage = function (opName, message) {
    console.log(`\n * ${opName + ':' || ''} ${message.truncate(100)} \n`)
}

var spinnerChars = ['|', '/', '-', '\\'];
var spinnerIndex = 0;
const silentWithSpinner = function() {
	spinnerIndex = (spinnerIndex > 3) ? 0 : spinnerIndex;
	process.stdout.write("\r" + spinnerChars[spinnerIndex++]);
}

const consoleWithMessage = function (opName, message, silent) {
    !silent ? console.log(`${opName}-${message.truncate(150)}`) : silentWithSpinner()
}

module.exports = {
    showBoxBanner,
    parseTemplate,
    getInputConfig,
    uploadLocalFile,
    getFunctionSha256,
    uploadLocalDirectory,
    uploadDirectoryAsZip,
    createOrUpdateStack,
    deleteStackOnComplete,
    deleteDeploymentBucket,
    deleteFunctionLayerVersions,
    createFunctionLayerVersion,
    updateFunctionConfiguration,
    getFunctionConfiguration,
    getFunctionMetricStatistics,
    getFunctionMetricData,
    checkStackStatusOnComplete,
    createOrUpdateFunction,
    createOrUpdateStackOnComplete,
    enableOrDisableLogEncryption,
    updateAPIGatewayDeployment,
    getFunctionMetaInfos,
    consoleWithMessage,
    finishWithMessage,
    finishWithSuccess,
    finishWithErrors
}

showBoxBanner()
