const path = require('path')
const fs = require('fs')
const AdmZip = require('adm-zip')
/**
 * adaptor.createFunction(params, callback)
 * adaptor.updateFunctionConfiguration(params, callback)
 * adaptor.createBucket(params, callback)
 * adaptor.upload(params, callback)
 * adaptor.createStack(params, callback)
 * adaptor.updateStack(params, callback)
 * adaptor.describeStacks(params, callback)
 */
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

const parseTemplate = function (...args) {
    var template = args.shift()
    function parseVariables(v) {
        Object.keys(process.env).map(function (e) {
            v = v.replace(new RegExp('\\${'+e+'}', 'g'), process.env[e])
        })
        args.forEach(function (a) {
            if (typeof a === 'object') {
                Object.keys(a).map(function (i) {
                    v = v.replace(new RegExp('\\${'+i+'}', 'g'), a[i])
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
    opName = opName || 'Simplify::createOrUpdateStack'
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

const checkStackStatusOnComplete = function (options, stackData) {
    var { adaptor, opName } = options
    opName = opName || 'Simplify::checkStackStatusOnComplete'
    return new Promise(function (resolve, reject) {
        var params = {
            StackName: stackData.StackId
        };
        adaptor.describeStacks(params, function (err, data) {
            if (err) resolve({
                Error: err
            }); // resolve to FINISH
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
                    resolve(currentStack) // resolve to FINISH
                } else {
                    reject(currentStack) // reject to CONTINUE
                }
            }
        });
    })
}

const uploadLocalDirectory = function (options) {
    var { adaptor, opName, bucketKey, inputDirectory } = options
    opName = opName || 'Simplify::uploadLocalDirectory'
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
                                            console.error(`${opName}-FileUpload-ERROR: ${err}`)
                                            reject(err)
                                        } else {
                                            fileInfos.push(data)
                                            console.log(`${opName}-FileUploaded: ${params.Key}`)
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
                    console.error(`${opName}-createBucket-ERROR: ${err} *** It has been created by another AWS Account worldwide!`)
                } else {
                    console.error(`${opName}-createBucket-ERROR: ${err}`)
                }
                reject(err)
            }
        })
    })
}

const uploadLocalFile = function (options) {
    var { adaptor, opName, bucketKey, inputLocalFile } = options
    opName = opName || 'Simplify::uploadLocalFile'
    var uploadFileName = path.basename(inputLocalFile)
    return new Promise(function (resolve, reject) {
        try {
            console.log(`${opName}-Reading: ${inputLocalFile}`)
            fs.readFile(inputLocalFile, function (err, data) {
                if (err) throw err;
                adaptor.createBucket(function (err) {
                    var params = {
                        Key: bucketKey + '/' + uploadFileName,
                        Body: data
                    };
                    if (!err || (err.code == 'BucketAlreadyOwnedByYou')) {
                        console.log(`${opName}-Uploading...`)
                        adaptor.upload(params, function (err, data) {
                            if (err) {
                                console.log(`${opName}-Upload-ERROR: ${err}`)
                                reject(err)
                            } else {
                                console.log(`${opName}-Uploaded: ${data.Location}`)
                                resolve(data)
                            }
                        });
                    } else {
                        console.error(`${opName}-createBucket-ERROR: ${err}`)
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
    opName = opName || 'Simplify::uploadDirectoryAsZip'
    var outputZippedFile = `${toDateStringFile()}.zip`
    var outputZippedFilePath = path.join(outputFilePath, outputZippedFile)
    return new Promise(function (resolve, reject) {
        try {
            const zip = new AdmZip();
            zip.addLocalFolder(inputDirectory)
            zip.writeZip(outputZippedFilePath)
            console.log(`${opName}-ZipFile: ${outputZippedFilePath}`)
            uploadLocalFile({ adaptor, opName, bucketKey, inputLocalFile: outputZippedFilePath }).then(function (data) {
                resolve(data)
            }).catch(function (err) { reject(err) })
        } catch (err) {
            console.error(`${opName}-ZipFile-ERROR: ${err}`);
            reject(err)
        }
    })
}

const createOrUpdateFunction = function (options) {
    var { adaptor, opName, bucketName, bucketKey, functionConfig } = options
    opName = opName || 'Simplify::createOrUpdateFunction'
    return new Promise(function (resolve, reject) {
        var params = {
            Code: {
                S3Bucket: bucketName,
                S3Key: bucketKey
            },
            ...functionConfig
        };
        console.log(`${opName}-UpdateFunction...`);
        adaptor.createFunction(params, function (err, data) {
            if (err) {
                console.log(`${opName}-UpdateConfig...`);
                delete params.Code;
                delete params.Publish;
                delete params.Tags;
                adaptor.updateFunctionConfiguration(params, function (err, data) {
                    if (err)
                        reject(err)
                    else
                        console.log(`${opName}-UpdateConfig: OK`);
                    adaptor.updateFunctionCode({
                        FunctionName: functionConfig.FunctionName,
                        S3Bucket: bucketName,
                        S3Key: bucketKey
                    }, function (err, data) {
                        if (err) {
                            console.error(`${opName}-FunctionUpdate-ERROR: ${err}`);
                            reject(err)
                        } else {
                            console.log(`${opName}-FunctionUpdated: OK`);
                            resolve(data)
                        }
                    })
                });
            } else {
                console.log(`${opName}-FunctionCreated: OK`);
                adaptor.updateFunctionCode({
                    FunctionName: functionName,
                    S3Bucket: bucketName,
                    S3Key: bucketKey
                }, function (err, data) {
                    if (err) {
                        console.error(`${opName}-FunctionUpdate-ERROR: ${err}`);
                        reject(err)
                    } else {
                        console.log(`${opName}-FunctionUpdated: OK`);
                        resolve(data)
                    }
                })
            }
        });
    })
}

const createOrUpdateStackOnComplete = function (options) {
    return new Promise(function (resolve, reject) {
        var { opName } = options
        const internvalTime = process.env.SIMPLIFY_STACK_INTERVAL || 5000
        var poolingTimeout = process.env.SIMPLIFY_STACK_TIMEOUT || 360
        const timeoutInMinutes = poolingTimeout * internvalTime
        opName = opName || 'Simplify::createOrUpdateStackOnComplete'
        createOrUpdateStack(options).then(function (data) {
            console.log(`${opName}-Update: Started with ${data.StackName || data.StackId}`);
            const whileStatusIsPending = function () {
                checkStackStatusOnComplete(options, data).then(function (data) {
                    console.log(`${opName}-Update: Done with ${data.StackStatus}`);
                    if (data.StackStatus == "DELETE_COMPLETE" || data.StackStatus == "DELETE_FAILED" ||
                        data.StackStatus == "ROLLBACK_COMPLETE" || data.StackStatus == "ROLLBACK_FAILED") {
                        reject(data)
                    } else {
                        resolve(data)
                    }
                }, function (stackObject) {
                    console.log(`${opName}-Update: ${stackObject.StackName} ${stackObject.StackStatus}`);
                    setTimeout(whileStatusIsPending, internvalTime);
                    if (--poolingTimeout <= 0) {
                        reject({ message: `Operation Timeout: Running over ${timeoutInMinutes} mins` })
                    }
                })
            }
            setTimeout(whileStatusIsPending, internvalTime);
        }, function (err) {
            console.error(`${opName}-Update-ERROR: ${err}`);
            reject(err)
        })
    })
}

module.exports = {
    parseTemplate,
    getInputConfig,
    uploadLocalFile,
    uploadLocalDirectory,
    uploadDirectoryAsZip,
    createOrUpdateStack,
    checkStackStatusOnComplete,
    createOrUpdateFunction,
    createOrUpdateStackOnComplete
}