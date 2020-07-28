'use strict';
const path = require('path')
if (typeof __non_webpack_require__ === 'undefined') global.__non_webpack_require__ = require

class StateExecution {
    
    constructor({ executionPath, executionName, verbosity }) {
        this.executionPath = executionPath || path.join(__dirname, "Functions")
        this.executionName = executionName
        this.verbosity = verbosity
        this.STATE_FINISH = [ "DONE", "ERROR" ]
    }

    verbose(...args) {
        this.verbosity && console.log(...args)
    }

    isFinished(state) {
        return this.STATE_FINISH.indexOf(state) === -1 ? false : true
    }

    runNextExecution({ event, context }, stateObject, states) {
        const _thisFunction = this

        return new Promise((resolve, reject) => {
            const _modulePath = `${path.join(_thisFunction.executionPath, stateObject.Run)}`
            const fModule = __non_webpack_require__(`${_thisFunction.executionName}`)
            let _stateFunction = __non_webpack_require__(_modulePath).handler
            if (process.env.MONOLITHIC_CODE == "YES" && fModule[stateObject.Run]) {
                _stateFunction = fModule[stateObject.Run].handler
            }
            _thisFunction.verbose(`StateExecution:RUN_CONTEXT name = ${stateObject.Run} args =`, JSON.stringify(event.args))
            _stateFunction(event, context, function (err, data) {
                if (err && !_thisFunction.isFinished(stateObject.Other)) {
                    event.dataContext = data
                    event.errorContext = err
                    event.retryState = event.retryState || stateObject.Retry
                    if (event.retryState && --event.retryState > 0) {
                        _thisFunction.verbose(`StateExecution:RETRY_CONTEXT name = ${stateObject.Run} count = ${event.retryState}`)
                        _thisFunction.runNextExecution({ event, context }, stateObject, states).then(data => resolve(data)).catch(err => reject(err))
                    } else {
                        const nextState = states.find(state => state.Run === stateObject.Other)
                        if (!nextState) reject({ message: `The execution state is not available: ${stateObject.Other}` })
                        _thisFunction.verbose(`StateExecution:RESULT name = ${stateObject.Run} error =`, JSON.stringify(event.errorContext))
                        _thisFunction.runNextExecution({ event, context }, nextState, states).then(data => resolve(data)).catch(err => reject(err))
                    }
                } else if (err && _thisFunction.isFinished(stateObject.Other)) {
                    event.retryState = event.retryState || stateObject.Retry
                    if (event.retryState && --event.retryState > 0) {
                        _thisFunction.verbose(`StateExecution:RETRY_CONTEXT name = ${stateObject.Run} count = ${event.retryState}`)
                        _thisFunction.runNextExecution({ event, context }, stateObject, states).then(data => resolve(data)).catch(err => reject(err))
                    } else {
                        _thisFunction.verbose(`StateExecution:ERROR name = ${stateObject.Run} error =`, JSON.stringify(err))
                        reject(err)
                    }
                } else if (!err && !_thisFunction.isFinished(stateObject.Next)) {
                    event.dataContext = data
                    event.errorContext = err
                    const nextState = states.find(state => state.Run === stateObject.Next)
                    if (!nextState) reject({ message: `The execution state is not available: ${stateObject.Next}` })
                    _thisFunction.verbose(`StateExecution:RESULT name = ${stateObject.Run} data =`, JSON.stringify(event.dataContext))
                    _thisFunction.runNextExecution({ event, context }, nextState, states).then(data => resolve(data)).catch(err => reject(err))
                } else if (!err && _thisFunction.isFinished(stateObject.Next)) {
                    _thisFunction.verbose(`StateExecution:FINISH name = ${stateObject.Run} data =`, JSON.stringify(data))
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
