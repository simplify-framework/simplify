#!/usr/bin/env node
'use strict';
const { printTable } = require('console-table-printer')
const http = require('http')
const crypto = require('crypto')
const fs = require('fs')

String.prototype.truncateLeft = function (num) {
    if (this.length <= num) { return this }
    return '...' + this.slice(this.length - num)
}

String.prototype.truncateRight = function (num) {
    if (this.length <= num) { return this }
    return this.slice(num) + '...'
}

const getOutputKeyValue = function(outputs, propKey) {
    var result = null
    outputs.some(function(output) {
        if (output.OutputKey === propKey) {
            result = output.OutputValue
            return true
        }
        return false
    })
    return result
}

const getSha256FileInHex = function(filePath) {
    const data = fs.readFileSync(filePath)
    return crypto.createHash('sha256').update(data).digest('hex')
}

const getSha256FileInBase64 = function(filePath) {
    const data = fs.readFileSync(filePath)
    return crypto.createHash('sha256').update(data).digest('base64')
}

const downloadFileFromUrl = function(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest, { flags: "wx" })
        const request = http.get(url, response => {
            if (response.statusCode === 200) {
                response.pipe(file)
            } else {
                file.close()
                fs.unlink(dest, () => {})
                reject({ message: `Server responded with ${response.statusCode}: ${response.statusMessage}` });
            }
        })
        request.on("error", err => {
            file.close()
            fs.unlink(dest, () => {})
            reject(err)
        })
        file.on("finish", () => {
            resolve()
        })
        file.on("error", err => {
            file.close()
            if (err.code === "EEXIST") {
                reject({ message: "File already exists" });
            } else {
                fs.unlink(dest, () => {})
                reject(err)
            }
        })
    })
}

module.exports = {
    getOutputKeyValue,
    getSha256FileInHex,
    getSha256FileInBase64,
    downloadFileFromUrl,
    printTableWithJSON: printTable,
}