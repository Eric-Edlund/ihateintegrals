import { a, b, negative, num, product, sum, x } from "./mathlib/ConvenientExpressions";
import { WebGraphView, WebGraphViewInitSettings } from "./mathlib/uielements/WebGraphView";
import { Graph } from "./mathlib/Graph";
import { Deriver } from "./mathlib/derivations/Deriver";
import { Expression } from "./mathlib/expressions/Expression";
import { RelationalDerivationRule } from "./mathlib/derivations/RelationalDerivationRule";
import { SubtractFromBothSides } from "./mathlib/derivations/algebra/SubtractFromBothSides";
import { DivideOnBothSides } from "./mathlib/derivations/algebra/DivideOnBothSides";
import { Variable } from "./mathlib/expressions/Variable";
import { Exponent } from "./mathlib/expressions/Exponent";
import { Fraction } from "./mathlib/expressions/Fraction";
import { Derivative } from "./mathlib/expressions/Derivative";
import { Logarithm } from "./mathlib/expressions/Logarithm";
import { Product } from "./mathlib/expressions/Product";
import { Sum } from "./mathlib/expressions/Sum";


RelationalDerivationRule.rules.add(new SubtractFromBothSides())
RelationalDerivationRule.rules.add(new DivideOnBothSides())

/**
 * Called after DOM is loaded.
 * Substitutes the body element in the document
 * with the primary integrator view.
 */
export function loadPrimaryPage(): void {

    //const root = Derivative.of(sum(a, a, product(num(2), b)), a)
    //const root = Derivative.of(product(num(3), Exponent.of(x, num(2)), Exponent.of(x, num(3))), x)
    //const root = product(Exponent.of(x, num(3)), Exponent.of(x, num(4)), x, x)
    //const root = Derivative.of(Fraction.of(Exponent.of(x, num(2)), x), x)
    //const root = Fraction.of(product(num(2), x, Exponent.of(x, a), a), product(num(2), a, a, x))
    const root = product(sum(a, b), sum(a, negative(b)), a, a)
    const graph = new Graph().addNode(root)

    const deriver = new Deriver(graph)
    deriver.expand(30, false)

    //console.log("Result: " + graph)

    const input = document.getElementById("input")
    input!.addEventListener("keyup", () => {
        //parse((input! as HTMLTextAreaElement).value)
    })


    const out = document.getElementById("outputbox")!;

    const config: WebGraphViewInitSettings = {
        showArguments: false,
        drawEdgeLines: true,
        debugCornerEnabled: true,
    }

    const graphView = new WebGraphView(graph, new Set([root]), config)
    graphView.setNodeColoringScheme(n => {
        if (n instanceof Expression) {
            if (!deriver.isSimplified(n)) return "lightgray"

            if (n instanceof Product)
                if (deriver.passedFactoringSimplification.has(n)) return "coral"
            if (n instanceof Sum)
                if (deriver.passedPolynomialSimplification.has(n)) return "yellow"
            if (deriver.passedConvergentSimplification.has(n)) return "lightgreen"
            

            if (n instanceof Variable) return "orange"

            return "lightblue"
        }
        return "black"
    })
    graphView.setAttribute("id", "web-graphview")
    out.appendChild(graphView)

}