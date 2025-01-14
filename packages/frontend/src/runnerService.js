import sandbox from './sandbox'
import Ajv from 'ajv'
import schema from './json-schemas/action.schema.json'
import movieQuotes from 'popular-movie-quotes'

const ajv = new Ajv({ allErrors: true })
const validateAction = ajv.compile(schema)

const invalidActionObject = {
    action: 'skip',
}

export const runnerService = new (function() {
    this.ticks = 0
    this.syncCalls = 0

    this.userCodes = {}

    // store changes  might be need to be moved out later
    // to some type of compute service.. for now, keep it here
    this.configureStore = function(store) {
        this.store = store
    }

    this.tick = function(initialState = {}, modifyStateCallback = undefined) {
        let tickOneWorkerUntilAllTicked = lastKnownState =>
            sandbox
                .postMessageWait('tick-one-worker', lastKnownState)
                .then(ackData => {
                    let actionObj = ackData.response || invalidActionObject

                    if (!validateAction(actionObj)) {
                        // yeah, errors get stored onto the function object..
                        console.warn(
                            'validation errors for action object',
                            actionObj,
                            'in',
                            ackData,
                            'were the following:\n',
                            validateAction.errors
                        )

                        actionObj = {
                            ...actionObj,
                            ...invalidActionObject,
                            message:
                                "action '" +
                                actionObj.action +
                                "' does not exist.",
                        }
                    }

                    // here is where we handle the response data in some way
                    let nextState = modifyStateCallback
                        ? modifyStateCallback(
                              ackData.name,
                              actionObj,
                              lastKnownState
                          )
                        : // state updates not connected
                          {}

                    let continuer = _state => {
                        if (ackData.allWorkersTicked === true) {
                            // all done
                            return true
                        } else if (ackData.allWorkersTicked === false) {
                            return tickOneWorkerUntilAllTicked(_state)
                        }
                    }

                    if (typeof nextState.then === 'function') {
                        // it's a promise
                        return nextState.then(_state => continuer(_state))
                    } else {
                        // we got a synchronous state back
                        return continuer(nextState)
                    }
                })

        return tickOneWorkerUntilAllTicked(initialState)
    }

    this.canTick = function() {
        return sandbox.doesSandboxExist()
    }

    this.setCodes = function(sets, sanitize = true, restart = true) {
        sandbox.restartSandbox().then(() => {
            Object.keys(sets).forEach(id =>
                this.setCode(id, sets[id], sanitize)
            )
        })
    }

    this.setCode = function(name, workerCode, sanitize = true) {
        if (name === undefined) {
            throw new Error('name cannot be empty!')
        }

        if (sanitize) {
            // don't pass annoying debugger; statements
            workerCode = workerCode.replace(
                /debugger/g,
                "(function() { console.log('debugger statement was here')})()"
            )
        }

        this.userCodes[name] = workerCode =
            workerCode + '\n\n// ' + movieQuotes.getRandomQuote()

        this.syncSandbox({ name })
    }

    this.syncSandbox = function(options = {}) {
        const defaults = {
            forceRestartIframe: false,
            syncCallsBeforeRestartingSandbox: 10,
        }

        options = { ...defaults, ...options }

        this.syncCalls++

        let shouldRestartIframe =
            options.forceRestartIframe ||
            this.syncCalls > this.syncCallsBeforeRestartingSandbox

        let getSandboxPromise

        if (this.syncCalls > this.syncCallsBeforeRestartingSandbox) {
            // restarting the sandbox is slower, but clears up blobs
            getSandboxPromise = sandbox.restartSandbox()
            console.log('restarting iframe to free up blob resources')
            this.syncCalls = 0
        } else {
            getSandboxPromise = sandbox.createSandboxIfNotExists()
        }

        // determine sandbox status, then update all the web workers
        return getSandboxPromise.then(() =>
            shouldRestartIframe || options.name === undefined
                ? Promise.all(
                      Object.keys(this.userCodes).map(name =>
                          sandbox.postMessageWait('add-or-update-webworker', {
                              name,
                              workerCode: this.userCodes[name],
                          })
                      )
                  )
                : // update single user
                  sandbox.postMessageWait('add-or-update-webworker', {
                      name: options.name,
                      workerCode: this.userCodes[options.name],
                  })
        )
        // sandbox
        //     .runScript(this.code)
        //     .then(() => {
        //         console.log('this.run complete')
        //     })
        //     .catch(() => {
        //         console.warn('this.run complete, with errors')
        //     })
    }
})()

window.runnerService = runnerService
export default runnerService
