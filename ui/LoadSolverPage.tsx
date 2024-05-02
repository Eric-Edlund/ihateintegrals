import { render } from "solid-js/web"
import { MathView } from "./mathlib/uielements/EditableMathView"
import { Expression } from "./mathlib/expressions/Expression"
import { parseExpressionJSON } from "./mathlib/expressions-from-json"
import { CasWorkerMsg, IncrementalSimplifyResult } from "./CasWorkerTypes"
import { Accessor, createEffect, createSignal } from "solid-js"
import { Step, StepList } from "./components/StepList"
import { ExpressionInput } from "./components/ExpressionInput"

declare const M: any

const casWorker = new Worker("casWorker.js")

const [expression, setExpression] = createSignal<Expression | null>(null)
const [steps, setSteps] = createSignal<Step[]>([])
const [answer, setAnswer] = createSignal<Expression | null>(null)

createEffect(() => {
    if (steps().length > 0) {
        setAnswer(steps()[steps().length - 1].expression)
    }
})

document.addEventListener("DOMContentLoaded", () => {
    const { mathInput: expressionInput, setFocused } = ExpressionInput({
        editCb: setExpression
    })
    render(() => expressionInput, document.getElementById("input")!)
    setFocused(true)
    window.addEventListener("keypress", () => {
        setFocused(true)
    })

    const answerSummary = document.getElementById(
        "answerSummary"
    )! as HTMLDivElement
    render(() => <MathViewSolid expression={answer} />, answerSummary)

    const stepListView = document.getElementById("stepsView")! as HTMLDivElement
    render(() => <StepList steps={steps} />, stepListView)

    casWorker.onmessage = (
        incrementalResult: MessageEvent<IncrementalSimplifyResult>
    ) => {
        const { steps: res, failed, forProblem } = incrementalResult.data

        if (failed || forProblem != expression()?.toJSON()) {
            return
        }

        const tmpSteps: Step[] = []
        for (let i = 1; i + 1 < res.length; i += 2) {
            let argument = res[i]
            let expression = res[i + 1]

            tmpSteps.push({
                argument: argument,
                expression: parseExpressionJSON(expression)
            })
        }

        setSteps(tmpSteps)
    }

    createEffect(() => {
        if (expression() === null) {
            casWorker.postMessage({
                cancel: true
            })
            return
        }

        console.log("Parsed " + expression()!.toJSON())

        casWorker.postMessage({
            expressionJson: expression()!.toJSON(),
            operation: "simplify"
        } as CasWorkerMsg)
    })

    var elems = document.querySelectorAll(".sidenav")
    M.Sidenav.init(elems, {})

})

interface MathViewSolidProps {
    expression: Accessor<Expression | null>
}

function MathViewSolid({ expression }: MathViewSolidProps) {
    return <>{new MathView(expression())}</>
}