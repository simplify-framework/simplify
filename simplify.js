const path = require('path')
const crypto = require('crypto')
const fs = require('fs')
const AdmZip = require('adm-zip')
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
 */

String.prototype.truncate = function (num) {
    if (this.length <= num) { return this }
    return '...' + this.slice(this.length - num)
}

const toDateStringFile = function () {
    var m = new Date();
    return m.getFullYear() +
        ("0" + (m.getMonth() + 1)).slice(-2) +
        ("0" + m.getDate()).slice(-2) + "T" +
        ("0" + m.getHours()).slice(-2) +
        ("0" + m.getMinutes()).slice(-2) +
        ("0" + m.getSeconds()).slice(-2)
}

const getDateToday = function () {
    var m = new Date();
    return m.getFullYear() + '-' +
        ("0" + (m.getMonth() + 1)).slice(-2) + '-' +
        ("0" + m.getDate()).slice(-2)
}

const getTimeMoment = function () {
    var m = new Date();
    return ("0" + m.getHours()).slice(-2) + ':' +
        ("0" + m.getMinutes()).slice(-2) + ':' +
        ("0" + m.getSeconds()).slice(-2)
}

const showBoxBanner = function () {
    console.log("╓───────────────────────────────────────────────────────────────╖")
    console.log("║                        Simplify Framework                     ║")
    console.log("╙───────────────────────────────────────────────────────────────╜")
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
        return v.replace(/\${DATE_TODAY}/g, getDateToday()).replace(/\${TIME_MOMENT}/g, getTimeMoment())
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
    var configInputFilePath = args.shift()
    var config = JSON.parse(fs.readFileSync(configInputFilePath))
    return parseTemplate(config, ...args)
}

const createOrUpdateStack = function (options) {
    var { adaptor, opName, stackName, stackParameters, stackTemplate } = options
    opName = opName || `${CBEGIN}Simplify::${CRESET}createOrUpdateStack`
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
            OnFailure: process.env.STACK_ON_FAILURE || "ROLLBACK",
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
    opName = opName || `${CBEGIN}Simplify::${CRESET}deleteExistingStack`
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
    opName = opName || `${CBEGIN}Simplify::${CRESET}checkStackStatusOnComplete`
    return new Promise(function (resolve, reject) {
        var params = {
            StackName: stackData.StackId
        };
        adaptor.describeStacks(params, function (err, data) {
            if (err) resolve({
                Error: err
            }); // resolve to FINISH in case there was an error
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
    opName = opName || `${CBEGIN}Simplify::${CRESET}uploadLocalDirectory`
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
                                            console.error(`${opName}-FileUpload: ${CERROR}(ERROR)${CRESET} ${err}`)
                                            reject(err)
                                        } else {
                                            fileInfos.push(data)
                                            console.log(`${opName}-FileUpload: ${params.Key}`)
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
                    console.error(`${opName}-CreateBucket: ${CERROR}(ERROR)${CRESET} ${err} *** It has been created by another AWS Account worldwide!`)
                } else {
                    console.error(`${opName}-CreateBucket: ${CERROR}(ERROR)${CRESET} ${err}`)
                }
                reject(err)
            }
        })
    })
}

const uploadLocalFile = function (options) {
    var { adaptor, opName, bucketKey, inputLocalFile } = options
    opName = opName || `${CBEGIN}Simplify::${CRESET}uploadLocalFile`
    var uploadFileName = path.basename(inputLocalFile)
    return new Promise(function (resolve, reject) {
        try {
            console.log(`${opName}-ReadFile: ${inputLocalFile.truncate(80)}`)
            fs.readFile(inputLocalFile, function (err, data) {
                if (err) throw err;
                const sha256Hex = crypto.createHash('sha256').update(data).digest('hex')
                adaptor.createBucket(function (err) {
                    var params = {
                        Key: bucketKey + '/' + uploadFileName,
                        Body: data
                    };
                    if (!err || (err.code == 'BucketAlreadyOwnedByYou')) {
                        adaptor.upload(params, function (err, data) {
                            if (err) {
                                console.log(`${opName}-FileUpload: ${CERROR}(ERROR)${CRESET} ${err}`)
                                reject(err)
                            } else {
                                console.log(`${opName}-FileUpload: ${data.Location.truncate(80)}`)
                                resolve({ ...data, FileSha256: sha256Hex })
                            }
                        });
                    } else {
                        console.error(`${opName}-CreateBucket: ${CERROR}(ERROR)${CRESET} ${err}`)
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
    var { adaptor, opName, bucketKey, inputDirectory, outputFilePath } = options
    opName = opName || `${CBEGIN}Simplify::${CRESET}uploadDirectoryAsZip`
    var outputZippedFile = `${toDateStringFile()}.zip`
    var outputZippedFilePath = path.join(outputFilePath, outputZippedFile)
    return new Promise(function (resolve, reject) {
        try {
            const zip = new AdmZip();
            zip.addLocalFolder(inputDirectory)
            zip.writeZip(outputZippedFilePath)
            console.log(`${opName}-ZipFile: ${outputZippedFilePath.truncate(80)}`)
            uploadLocalFile({ adaptor, opName, bucketKey, inputLocalFile: outputZippedFilePath }).then(function (data) {
                resolve(data)
            }).catch(function (err) { reject(err) })
        } catch (err) {
            console.error(`${opName}-ZipFile: ${CERROR}(ERROR)${CRESET} ${err}`);
            reject(err)
        }
    })
}

const createOrUpdateFunction = function (options) {
    var { adaptor, opName, bucketName, bucketKey, functionConfig } = options
    opName = opName || `${CBEGIN}Simplify::${CRESET}createOrUpdateFunction`
    return new Promise(function (resolve, reject) {
        var params = {
            Code: {
                S3Bucket: bucketName,
                S3Key: bucketKey
            },
            ...functionConfig
        };
        console.log(`${opName}-CreateFunction: ${functionConfig.FunctionName.truncate(80)}`);
        adaptor.createFunction(params, function (err) {
            if (err) {
                console.log(`${opName}-UpdateFunctionConfig: ${functionConfig.FunctionName.truncate(80)}`);
                const unusedProps = ["Code", "Publish", "Tags"]
                unusedProps.forEach(function (k) { delete params[k] })
                adaptor.updateFunctionConfiguration(params, function (err) {
                    if (err) {
                        reject(err)
                    } else {
                        console.log(`${opName}-UpdateFunctionConfig: ${CDONE}(OK)${CRESET}`);
                        adaptor.updateFunctionCode({
                            FunctionName: functionConfig.FunctionName,
                            S3Bucket: bucketName,
                            S3Key: bucketKey
                        }, function (err, data) {
                            if (err) {
                                console.error(`${opName}-UpdateFunctionCode: ${CERROR}(ERROR)${CRESET} ${err}`);
                                reject(err)
                            } else {
                                console.log(`${opName}-UpdateFunctionCode: ${CDONE}(OK)${CRESET}`);
                                resolve(data)
                            }
                        })
                    }
                });
            } else {
                console.log(`${opName}-CreateFunction: ${CDONE}(OK)${CRESET}`);
                adaptor.updateFunctionCode({
                    FunctionName: functionName,
                    S3Bucket: bucketName,
                    S3Key: bucketKey
                }, function (err, data) {
                    if (err) {
                        console.error(`${opName}-UpdateFunctionCode: ${CERROR}(ERROR)${CRESET} ${err}`);
                        reject(err)
                    } else {
                        console.log(`${opName}-UpdateFunctionCode: ${CDONE}(OK)${CRESET}`);
                        resolve(data)
                    }
                })
            }
        });
    })
}

const updateFunctionConfiguration = function (options) {
    var { adaptor, opName, functionConfig } = options
    opName = opName || `${CBEGIN}Simplify::${CRESET}updateFunctionConfiguration`
    return new Promise(function (resolve, reject) {
        const unusedProps = ["Code", "Publish", "Tags"]
        unusedProps.forEach(function (k) { delete functionConfig[k] })
        adaptor.updateFunctionConfiguration({ ...functionConfig }, function (err, data) {
            if (err) {
                console.error(`${opName}-UpdateFunctionConfig: ${CERROR}(ERROR)${CRESET} ${err}`);
                reject(err)
            } else {
                console.log(`${opName}-UpdateFunctionConfig: ${CDONE}(OK)${CRESET}`);
                resolve(data)
            }
        })
    })
}

const createFunctionLayerVersion = function (options) {
    var { adaptor, opName, bucketName, bucketKey, functionConfig, layerConfig } = options
    opName = opName || `${CBEGIN}Simplify::${CRESET}createFunctionLayerVersion`
    return new Promise(function (resolve, reject) {
        var params = {
            Content: {
                S3Bucket: bucketName,
                S3Key: bucketKey
            },
            ...layerConfig
        };
        console.log(`${opName}-CreateFunctionLayer: ${layerConfig.LayerName}`);
        adaptor.publishLayerVersion(params, function (err, data) {
            if (err) {
                console.error(`${opName}-CreateLayerVersion: ${CERROR}(ERROR)${CRESET} ${err}`);
                reject(err)
            } else {
                console.log(`${opName}-UpdateFunctionConfig: ${layerConfig.LayerName}`);
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
                        console.error(`${opName}-UpdateFunctionConfig: ${CERROR}(ERROR)${CRESET} ${err}`);
                        reject(err)
                    } else {
                        console.log(`${opName}-UpdateFunctionConfig: ${CDONE}(OK)${CRESET}`);
                        resolve(data)
                    }
                })
            }
        });
    })
}

const getFunctionMetaInfos = function (options) {
    var { adaptor, opName, functionConfig } = options
    opName = opName || `${CBEGIN}Simplify::${CRESET}getFunctionMetaInfos`
    return new Promise(function (resolve, reject) {
        var params = {
            FunctionName: functionConfig.FunctionName
        };
        console.log(`${opName}-GetFunction: ${functionConfig.FunctionName.truncate(80)}`);
        adaptor.getFunction(params, function (err, data) {
            if (err) {
                console.error(`${opName}-GetFunction: ${CERROR}(ERROR)${CRESET} ${err}`);
                reject(err)
            } else {
                let layerIndex = 0
                let functionData = { ...data, LayerInfos: [] }
                functionData.Configuration.Layers = functionData.Configuration.Layers || []
                console.log(`${opName}-GetFunctionLayers: ${functionConfig.FunctionName.truncate(80)}`);
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
                if (functionData.Configuration.Layers.length > 0) {
                    getLayerInfoRecusive(layerIndex)
                }
            }
        });
    })
}

const updateAPIGatewayDeployment = function (options) {
    var { adaptor, opName, apiConfig } = options
    opName = opName || `${CBEGIN}Simplify::${CRESET}updateAPIGatewayDeployment`
    return new Promise(function (resolve, reject) {
        console.log(`${opName}-CreateDeployment: ${apiConfig.GatewayId}`);
        adaptor.createDeployment({
            stageName: apiConfig.StageName,
            restApiId: apiConfig.GatewayId
        }, function (err, data) {
            if (err) {
                console.error(`${opName}-CreateDeployment: ${CERROR}(ERROR)${CRESET} ${err}`);
                reject(err)
            } else {
                adaptor.updateStage({
                    stageName: apiConfig.StageName,
                    restApiId: apiConfig.GatewayId,
                    patchOperations: [{ op: 'replace', path: '/deploymentId', value: data.id }]
                }, function (err, data) {
                    if (err) {
                        console.error(`${opName}-UpdateDeploymentStage: ${CERROR}(ERROR)${CRESET} ${err}`);
                        reject(err)
                    } else {
                        console.log(`${opName}-UpdateDeploymentStage: ${CDONE}(OK)${CRESET}`);
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
        opName = opName || `${CBEGIN}Simplify::${CRESET}createOrUpdateStackOnComplete`
        createOrUpdateStack(options).then(function (data) {
            console.log(`${opName}-CreateStackOrUpdate: Started with ${(data.StackName || data.StackId).truncate(80)}`);
            const whileStatusIsPending = function () {
                checkStackStatusOnComplete(options, data).then(function (data) {
                    console.log(`${opName}-CreateStackOrUpdate: ${CDONE}(OK)${CRESET} with ${data.StackStatus}`);
                    if (data.StackStatus == "DELETE_COMPLETE" || data.StackStatus == "DELETE_FAILED" ||
                        data.StackStatus == "ROLLBACK_COMPLETE" || data.StackStatus == "ROLLBACK_FAILED" ||
                        data.StackStatus == "CLEANUP_COMPLETE") {
                        reject(data)
                    } else {
                        resolve(data)
                    }
                }, function (stackObject) {
                    console.log(`${opName}-CreateStackOrUpdate: ${stackObject.StackStatus} ${stackObject.StackStatusReason || ''}`);
                    setTimeout(whileStatusIsPending, internvalTime);
                    if (--poolingTimeout <= 0) {
                        reject({ message: `Operation Timeout: Running over ${timeoutInMinutes} mins` })
                    }
                })
            }
            setTimeout(whileStatusIsPending, internvalTime);
        }, function (err) {
            console.error(`${opName}-CreateStackOrUpdate: ${CERROR}(ERROR)${CRESET} ${err}`);
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
        opName = opName || `${CBEGIN}Simplify::${CRESET}deleteStackOnComplete`
        deleteExistingStack(options).then(function (data) {
            console.log(`${opName}-DeleteExistingStack: Started to delete ${options.stackName}`);
            const whileStatusIsPending = function () {
                checkStackStatusOnComplete(options, data).then(function (data) {
                    console.log(`${opName}-DeleteExistingStack: ${CDONE}(OK)${CRESET} with ${data.StackStatus}`);
                    if (data.StackStatus == "DELETE_COMPLETE" || data.StackStatus == "DELETE_FAILED" ||
                        data.StackStatus == "ROLLBACK_COMPLETE" || data.StackStatus == "ROLLBACK_FAILED") {
                        reject(data)
                    } else {
                        resolve(data)
                    }
                }, function (stackObject) {
                    console.log(`${opName}-DeleteExistingStack: ${stackObject.StackStatus} ${stackObject.StackStatusReason || ''}`);
                    setTimeout(whileStatusIsPending, internvalTime);
                    if (--poolingTimeout <= 0) {
                        reject({ message: `Operation Timeout: Running over ${timeoutInMinutes} mins` })
                    }
                })
            }
            setTimeout(whileStatusIsPending, internvalTime);
        }, function (err) {
            console.error(`${opName}-DeleteExistingStack: ${CERROR}(ERROR)${CRESET} ${err}`);
            reject(err)
        })
    })
}

const deleteFunctionLayerVersions = function (options) {
    var { adaptor, opName, functionConfig } = options
    opName = opName || `${CBEGIN}Simplify::${CRESET}deleteFunctionLayerVersions`
    return new Promise(function (resolve, reject) {
        let layerDeletionIndex = 0
        functionConfig.Layers = functionConfig.Layers || []
        functionConfig.Layers.forEach(function (layer) {
            const layerArnWithVersion = layer.split(':')
            const layerOnlyARN = layerArnWithVersion.splice(0, layerArnWithVersion.length - 1).join(':')
            console.log(`${opName}-ListLayerVersions: ${layerOnlyARN.truncate(80)}`);
            adaptor.listLayerVersions({ LayerName: layerOnlyARN }, function (err, data) {
                let layerVersionIndex = 0
                function deleteOneLayerVersion(index) {
                    const layerVersionNumber = data.LayerVersions[index].Version
                    adaptor.deleteLayerVersion({ LayerName: layerOnlyARN, VersionNumber: layerVersionNumber }, function (err) {
                        if (err) {
                            console.error(`${opName}-DeleteLayerVersion: ${CERROR}(ERROR)${CRESET} ${err}`);
                        } else if (++index < data.LayerVersions.length) {
                            console.log(`${opName}-DeleteLayerVersion: ${CDONE}(OK)${CRESET} ${layerOnlyARN.truncate(80)}:${layerVersionNumber}`);
                            deleteOneLayerVersion(index)
                        } else {
                            console.log(`${opName}-DeleteLayerVersion: ${CDONE}(OK)${CRESET} ${layerOnlyARN.truncate(80)}:${layerVersionNumber}`);
                            if (++layerDeletionIndex>=functionConfig.Layers.length) {
                                resolve(functionConfig.Layers)
                            }
                        }
                    })
                }
                if (err) {
                    console.error(`${opName}-ListLayerVersions: ${CERROR}(ERROR)${CRESET} ${err}`);
                    reject(err)
                } else if (data.LayerVersions.length > 0) {
                    deleteOneLayerVersion(layerVersionIndex)
                }
            })
        })
    })
}

module.exports = {
    showBoxBanner,
    parseTemplate,
    getInputConfig,
    uploadLocalFile,
    uploadLocalDirectory,
    uploadDirectoryAsZip,
    createOrUpdateStack,
    deleteStackOnComplete,
    deleteFunctionLayerVersions,
    createFunctionLayerVersion,
    updateFunctionConfiguration,
    checkStackStatusOnComplete,
    createOrUpdateFunction,
    createOrUpdateStackOnComplete,
    updateAPIGatewayDeployment,
    getFunctionMetaInfos
}

showBoxBanner()