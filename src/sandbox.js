import IFRAME_HTML from '!raw-loader!./iframe-isolated/iframe.html'
import IFRAME_CODE from '!raw-loader!./iframe-isolated/iframe.template.js'
import IFRAME_WEBWORKER_CODE from '!raw-loader!./iframe-isolated/webworker.template.js'

import { postMessageWait } from './postMessageBroker'

// const iframeTopics = {
//     close: 'close',
//     'close-webworkers': 'close-webworkers',
// }

export const sandbox = new (function() {
    const TIMEOUT = 2000
    const TIMEOUT_DEBUG = 100000000

    this.getExistingSandbox = () => document.querySelector('iframe#runner')

    this.doesSandboxExist = () => !!this.getExistingSandbox()

    this.killSandbox = (timeout = TIMEOUT_DEBUG) => {
        let runnerIframe = this.getExistingSandbox()
        if (runnerIframe) {
            return postMessageWait(
                runnerIframe.contentWindow,
                'close',
                { targetOrigin: '*' },
                { timeout }
            ).then(() => runnerIframe.remove())
        } else {
            return new Promise(resolve => resolve(false))
        }
    }

    this.killWorkers = (timeout = TIMEOUT_DEBUG) => {
        let runnerIframe = this.getExistingSandbox()
        if (runnerIframe) {
            return postMessageWait(
                runnerIframe.contentWindow,
                'close-webworkers',
                { targetOrigin: '*' },
                { timeout }
            )
        } else {
            return new Promise(resolve => resolve(false))
        }
    }

    this.createSandboxIfNotExists = () =>
        new Promise((resolve, reject) => {
            let existing = this.getExistingSandbox()

            if (existing === null) {
                try {
                    const iframe = document.createElement('iframe')

                    iframe.setAttribute('id', 'runner')

                    iframe.setAttribute('sandbox', 'allow-scripts')
                    iframe.style.display = 'none'

                    const iframeHtml = IFRAME_HTML.replace(
                        '/* IFRAME_CODE */',
                        IFRAME_CODE
                    ).replace(
                        '/* IFRAME_WEBWORKER_CODE */',
                        IFRAME_WEBWORKER_CODE
                    )
                    // .replace(
                    //     '/* DATA_CODE */',
                    //     "...JSON.parse('" + JSON.stringify(data) + "')\n"
                    // )
                    // .replace('/* USER_CODE */', code)

                    iframe.src =
                        'data:text/html;charset=utf-8,' + encodeURI(iframeHtml)

                    let timeoutId
                    let loadListener = window.addEventListener(
                        'message',
                        event => {
                            if (event.data.topic === 'iframe-loaded') {
                                if (timeoutId) {
                                    clearTimeout(timeoutId)
                                }

                                window.removeEventListener(
                                    'message',
                                    loadListener
                                )

                                resolve(iframe)
                            }
                        },
                        false
                    )

                    document.body.appendChild(iframe)

                    setTimeout(() => {
                        this.killSandbox()
                        reject(new Error('iframe failed to initialize'))
                    }, TIMEOUT_DEBUG)
                } catch (e) {
                    reject(e)
                }
            } else {
                resolve(existing)
            }
        })

    this.restartSandbox = (timeout = TIMEOUT_DEBUG) =>
        this.killSandbox().then(this.createSandboxIfNotExists)

    this.postMessageWait = (topic, data = {}) =>
        this.createSandboxIfNotExists().then(sandboxIframe =>
            postMessageWait(
                sandboxIframe.contentWindow,
                { topic, ...data },
                {
                    targetOrigin: '*',
                },
                { timeout: TIMEOUT_DEBUG }
            )
        )

    this.runScript = (code, state, options = {}) => {
        // add a web worker, run it, then exit

        const defaultOptions = {
            data: undefined,
            timeout: TIMEOUT_DEBUG,
            reuseSandbox: true,
        }

        const { data, timeout, reuseSandbox } = {
            ...defaultOptions,
            ...options,
        }

        console.time('runScript')

        let getSandboxPromise = reuseSandbox
            ? this.createSandboxIfNotExists()
            : this.restartSandbox()

        return getSandboxPromise
            .then(sandboxIframe =>
                postMessageWait(
                    sandboxIframe.contentWindow,
                    { topic: 'add-webworker-once', workerCode: code, state },
                    {
                        targetOrigin: '*',
                    },
                    { timeout: TIMEOUT_DEBUG }
                )
            )
            .then(result => {
                if (result) {
                    console.timeEnd('runScript')
                    return result.ackData
                } else {
                    console.timeEnd('runScript')
                    throw new Error('failed to execute script')
                }
            })
            .catch(e => {
                console.timeEnd('runScript')
                throw e
            })
    }
})()

window.sandbox = sandbox;
export default sandbox
