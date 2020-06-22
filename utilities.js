#!/usr/bin/env node
'use strict';
const { printTable, Table } = require('console-table-printer')
const http = require('http')
const crypto = require('crypto')
const fs = require('fs')

String.prototype.truncate = function (num, chars) {
    if (this.length <= num) { return this }
    return (typeof chars === 'undefined' ? '...' : chars) + this.slice(this.length - num)
}

String.prototype.toCamelCase = function () {
    return this.replace(/(?:^\w|[A-Z]|\b\w)/g, function (word, index) {
        return index === 0 ? word.toLowerCase() : word.toUpperCase();
    }).replace(/\s+/g, '').split(' ').join('').split('-').join('');
}

String.prototype.truncateLeft = function (num, chars) {
    if (this.length <= num) { return this }
    return (typeof chars === 'undefined' ? '...' : chars) + this.slice(this.length - num)
}

String.prototype.truncateRight = function (num, chars) {
    if (this.length <= num) { return this }
    return this.slice(0, this.length - num) + (typeof chars === 'undefined' ? '...' : chars)
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
    PrintTable: Table,
    toDateStringFile,
    getDateToday,
    getTimeMoment
}
