import { Argument } from "../Argument"
import { GraphEdge, MathGraphNode } from "../Graph"
import { Inference } from "../Inference"
import { uiPreferences } from "./UIPreferences"

/**
 * Represents an edge in a graph.
 */
export class EdgeView extends HTMLParagraphElement {
    public constructor(edge: {n: MathGraphNode, n1: MathGraphNode, e: GraphEdge}) {
        super()
        this.edge = edge.e
        this.first = edge.n
        this.second = edge.n1

        this.style.width = "fit-content"
        this.style.height = "fit-content"
        this.style.padding = "0"
        this.style.zIndex = "-2"
        this.style.margin = "0"
        this.style.whiteSpace = "nowrap"
        this.style.textAlign = "center"
        this.style.backgroundColor = uiPreferences.edgeEqualsBackgroundColor

        uiPreferences.onUpdate(() => {
            this.style.backgroundColor = uiPreferences.edgeEqualsBackgroundColor
        })
        
        this.addEventListener("click", event => {

        })
        this.addEventListener("mouseout", event => {
            
        })
    }

    /**
     * Sets rotation angle of view while also
     * letting it know the angle has changed.
     * @param rad 
     */
    public setAngle(rad: number): void {
        this.style.rotate = "" + rad + "rad"
        //this.textContent = "" + (rad * 2 * Math.PI / 360).toFixed(2) + "deg"
    }

    /**
     * Sets element screen width and ensures text fits
     * inside the edge.
     */
    public set width(val: string) {
        super.style.width = val
    }

    /**
     * Called when element is conncted to the DOM.
     */
    public connectedCallback(): void {
        if (this.edge instanceof Inference) {
            this.textContent = "" + this.edge.relationship
        } else if (this.edge instanceof Argument) {
            this.textContent = "" + this.edge.claim.r
        } else {
            this.textContent = "'" + this.first.toString() + "' -> '" + this.second.toString() + "'"
        }
    }

    private readonly edge: GraphEdge;
    public readonly first: MathGraphNode;
    public readonly second: MathGraphNode;
}

customElements.define("edge-view", EdgeView, {extends: "p"});