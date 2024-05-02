import { MathView } from "./mathlib/uielements/EditableMathView"
import { Expression } from "./mathlib/expressions/Expression"
import { parseExpressionJSON } from "./mathlib/expressions-from-json"
import { parseExpressionLatex } from "./mathlib/userinput/LatexParser"
import { CasWorkerMsg, IncrementalSimplifyResult } from "./CasWorkerTypes"

declare const MathJax: any
declare const MQ: any
declare const M: any

const casWorker = new Worker("casWorker.js")

document.addEventListener("DOMContentLoaded", () => {
    const answerSummary = document.getElementById(
        "answerSummary"
    )! as HTMLDivElement

    // Displays the final answer
    const solutionView = new MathView()

    // Displays sequence of steps leading to the final answer
    const stepListView = document.getElementById("stepsView")! as HTMLDivElement

    const inputView = document.getElementById("input")!

    // The last valid entered expression
    let expression: Expression | null

    casWorker.onmessage = (
        incrementalResult: MessageEvent<IncrementalSimplifyResult>
    ) => {
        const { steps, failed, forProblem } = incrementalResult.data

        if (failed || forProblem != expression!.toJSON()) {
            return
        }

        console.log(JSON.stringify(steps))
        solutionView.value = parseExpressionJSON(steps[steps.length - 1])
        stepListView.innerHTML = ""
        for (let i = 1; i + 1 < steps.length; i += 2) {
            let argument = steps[i]
            let expression = steps[i + 1]

            stepListView.appendChild(<Row argument={argument} expression={expression}></Row>)
        }
        MathJax.typeset([answerSummary, stepListView])
    }

    /**
     * Starts solving it in the background.
     * @effects The solution steps view and summary div.
     *      Does not effect the input area.
     */
    function onInputExpressionChanged() {
        if (expression === undefined) return
        if (expression === null) {
            solutionView.innerHTML = ""
            stepListView.innerHTML = ""
            casWorker.postMessage({
                cancel: true
            })
            return
        }

        console.log("Parsed " + expression.toJSON())

        casWorker.postMessage({
            expressionJson: expression.toJSON(),
            operation: "simplify"
        } as CasWorkerMsg)
    }

    const view = document.createElement("textarea")
    const quill = MQ.MathField(inputView, {
        handlers: {
            edit: function () {
                const parseResult = parseExpressionLatex(quill.latex())
                if (parseResult === "empty") {
                    expression = null
                    onInputExpressionChanged()
                    return
                }
                expression = parseResult
                if (expression == null) {
                    inputView.style.color = "red"
                    // Also set border color
                    // https://docs.mathquill.com/en/latest/Config/#changing-colors
                    inputView.style.borderColor = "red"
                } else {
                    inputView.style.color = "black"
                    inputView.style.borderColor = "black"
                }
                onInputExpressionChanged()
            }
        },
        autoCommands: "int pi sqrt",
        substituteTextarea: function () {
            return view
        }
    })
    view.focus()

    answerSummary.replaceChildren(solutionView)

    var elems = document.querySelectorAll(".sidenav")
    M.Sidenav.init(elems, {})

    // Shortcuts
    document.getElementById("body")!.addEventListener("keypress", () => {
        view.focus()
    })
})

interface RowProps {
    argument: string
    expression: string
}

/**
 * Creates an argument row for the solution steps list.
 */
function Row({argument, expression}: RowProps): HTMLDivElement {
    const row = document.createElement("div")
    row.classList.add("row")

    const argumentView = document.createElement("p")
    argumentView.innerText = argument
    argumentView.classList.add("col", "s6")
    row.appendChild(argumentView)

    const expressionView = new MathView()
    expressionView.value = parseExpressionJSON(expression)
    row.appendChild(expressionView)

    return row
}
