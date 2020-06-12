'use strict';
const path = require('path')

class StateExecution {

    constructor({ executionPath, verbosity }) {
        this.executionPath = executionPath || path.join(__dirname, "Functions")
        this.verbosity = verbosity
    }

    verbose(...args) {
        this.verbosity && console.log(args)
    }

    runNextExecution({ args, context }, stateObject, states) {
        const _thisFunction = this
        return new Promise((resolve, reject) => {
            const _stateFunction = require(path.join(_thisFunction.executionPath, stateObject.Run)).handler
            _thisFunction.verbose("StateExecution:RUN_CONTEXT", args, context)
            _stateFunction(args, context, function (err, data) {
                if (err && stateObject.Other !== "DONE") {
                    context.dataContext = data
                    context.errorContext = err
                    context.retryState = context.retryState || stateObject.Retry
                    if (context.retryState && context.retryState > 0) {
                        context.retryState--
                        _thisFunction.verbose("StateExecution:RETRY_CONTEXT count=", context.retryState)
                        _thisFunction.runNextExecution({ args, context }, stateObject, states).then(data => resolve(data)).catch(err => reject(err))
                    } else {
                        _thisFunction.verbose("StateExecution:OTHER_CONTEXT", data)
                        const nextState = states.find(state => state.Run === stateObject.Other)
                        if (!nextState) reject({ message: `The execution state is not available: ${stateObject.Other}` })
                        _thisFunction.runNextExecution({ args, context }, nextState, states).then(data => resolve(data)).catch(err => reject(err))
                    }
                } else if (err && stateObject.Other === "DONE") {
                    context.retryState = context.retryState || stateObject.Retry
                    if (context.retryState && context.retryState > 0) {
                        context.retryState--
                        _thisFunction.verbose("StateExecution:RETRY_CONTEXT count=", context.retryState)
                        _thisFunction.runNextExecution({ args, context }, stateObject, states).then(data => resolve(data)).catch(err => reject(err))
                    } else {
                        _thisFunction.verbose("StateExecution:ERROR_CONTEXT", data)
                        reject(data)
                    }
                } else if (!err && stateObject.Next !== "DONE") {
                    context.dataContext = data
                    context.errorContext = err
                    _thisFunction.verbose("StateExecution:NEXT_CONTEXT", data)
                    const nextState = states.find(state => state.Run === stateObject.Next)
                    if (!nextState) reject({ message: `The execution state is not available: ${stateObject.Next}` })
                    _thisFunction.runNextExecution({ args, context }, nextState, states).then(data => resolve(data)).catch(err => reject(err))
                } else if (!err && stateObject.Next === "DONE") {
                    _thisFunction.verbose("StateExecution:DONE_CONTEXT", data)
                    resolve(data)
                }
            })
        })
    }

    execute(states, args, dataType, dataSchema) {
        return this.runNextExecution({ args, context: { dataType, dataSchema } }, states[0], states)
    }
}

module.exports = {
    StateExecution
}