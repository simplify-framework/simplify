'use strict';
const path = require('path')

class StateExecution {

    constructor({ executionPath, verbosity }) {
        this.executionPath = executionPath || path.join(__dirname, "Functions")
        this.verbosity = verbosity
    }

    verbose(...args) {
        this.verbosity && console.log(...args)
    }

    runNextExecution({ event, context }, stateObject, states) {
        const _thisFunction = this
        return new Promise((resolve, reject) => {
            const _stateFunction = require(path.join(_thisFunction.executionPath, stateObject.Run)).handler
            _thisFunction.verbose(`StateExecution:RUN_CONTEXT name = ${stateObject.Run} args =`, JSON.stringify(event.args))
            _stateFunction(event, context, function (err, data) {
                if (err && stateObject.Other !== "DONE") {
                    event.dataContext = data
                    event.errorContext = err
                    event.retryState = event.retryState || stateObject.Retry
                    if (event.retryState && --event.retryState > 0) {
                        _thisFunction.verbose(`StateExecution:RETRY_CONTEXT name = ${stateObject.Run} count = ${event.retryState}`)
                        _thisFunction.runNextExecution({ event, context }, stateObject, states).then(data => resolve(data)).catch(err => reject(err))
                    } else {
                        const nextState = states.find(state => state.Run === stateObject.Other)
                        if (!nextState) reject({ message: `The execution state is not available: ${stateObject.Other}` })
                        _thisFunction.verbose(`StateExecution:OTHER_CONTEXT name = ${nextState.Run}`)
                        _thisFunction.runNextExecution({ event, context }, nextState, states).then(data => resolve(data)).catch(err => reject(err))
                    }
                } else if (err && stateObject.Other === "DONE") {
                    event.retryState = event.retryState || stateObject.Retry
                    if (event.retryState && --event.retryState > 0) {
                        _thisFunction.verbose(`StateExecution:RETRY_CONTEXT name = ${stateObject.Run} count = ${event.retryState}`)
                        _thisFunction.runNextExecution({ event, context }, stateObject, states).then(data => resolve(data)).catch(err => reject(err))
                    } else {
                        _thisFunction.verbose(`StateExecution:ERROR_CONTEXT name = ${stateObject.Run}`)
                        reject(err)
                    }
                } else if (!err && stateObject.Next !== "DONE") {
                    event.dataContext = data
                    event.errorContext = err
                    const nextState = states.find(state => state.Run === stateObject.Next)
                    if (!nextState) reject({ message: `The execution state is not available: ${stateObject.Next}` })
                    _thisFunction.verbose(`StateExecution:NEXT_CONTEXT name = ${nextState.Run}`)
                    _thisFunction.runNextExecution({ event, context }, nextState, states).then(data => resolve(data)).catch(err => reject(err))
                } else if (!err && stateObject.Next === "DONE") {
                    _thisFunction.verbose(`StateExecution:DONE_CONTEXT name = ${stateObject.Run}`)
                    resolve(data)
                }
            })
        })
    }

    execute(states, args, dataType, dataSchema) {
        return this.runNextExecution({ event: {
            ...args, dataType, dataSchema
        }, context: args.context }, states[0], states)
    }
}

module.exports = {
    StateExecution
}