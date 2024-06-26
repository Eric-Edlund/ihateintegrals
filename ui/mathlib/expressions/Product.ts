import { productOrNot } from "../ConvenientExpressions"
import { assert } from "../util/assert" 
import { VariableValueMap } from "../VariableValueMap" 
import { Exponent, ExponentType } from "./Exponent" 
import { Expression } from "./Expression"
import { Integer, IntegerType } from "./Integer"
import { NameTable } from "./MathElement"
import { SumType } from "./Sum"
import { Variable } from "./Variable"

/**
 * A mathematical product with 2 or more factors.
 */
export class Product extends Expression {
    /**
     * For efficiency, products are compared by reference.
     * Here we ensure === <=> ==
     * @param factors
     * @returns
     */
    public static of(factors: Expression[]): Product {
        const hash = factors.map<string>(e => e.hash).join("")
        if (!Product.instances.has(hash))
            Product.instances.set(hash, new Product(factors))
        return Product.instances.get(hash)!
    }
    private static instances: Map<string, Product> = new Map()

    private constructor(factors: Expression[]) {
        super()
        assert(
            factors.length >= 2,
            "Creating product with less than 2 factors."
        )
        this.factors = factors
        Object.freeze(this.factors)

        let reducible = true
        this.factors.forEach(f => {
            reducible &&= f.isReducible || f.class == IntegerType
        })
        // The integers are closed over multiplication
        this.isReducible = reducible

        let healthy = true
        healthy &&= this.numNegatives() < 2

        let isNegation = factors.length == 2
        isNegation &&=
            factors.filter(e => {
                return e instanceof Integer && (e as Integer).value == -1
            }).length == 1
        this.isNegation = isNegation

        this.isConstant = this.factors
            .map<boolean>(f => f.isConstant)
            .reduce((a, b) => a && b)
        this.childCount =
            factors.length +
            factors.map<number>(f => f.childCount).reduce((a, b) => a + b) -
            (this.isNegation ? 1 : 0)
    }

    /**
     * True if this product is just
     * -1 * another expression.
     */
    public readonly isNegation: boolean

    /**
     * Get the value that this product is negating
     * -1 * exp returns exp.
     * @throws if product isn't a negation.
     */
    public get negation(): Expression {
        assert(this.isNegation, "Trying to get negation from non-negating sum")
        if (
            this.factors[0].class == IntegerType &&
            (this.factors[0] as Integer).value == -1
        )
            return this.factors[1]
        return this.factors[0]
    }

    /**
     * Returns a new Expression without the given factor.
     * If the product contains the factor multiple times,
     * only removes one. If it doesn't contain the factor,
     * returns itself.
     * @param exp A factor in this product.
     */
    public without(exp: Expression): Expression {
        const newFactors = [...this.factors]

        const index = newFactors.findIndex(value => {
            return value === exp
        })
        if (index == -1) return this

        newFactors.splice(index, 1)
        if (newFactors.length < 2) {
            return newFactors[0] // Gauranteed there's one term here
        }
        return Product.of(newFactors)
    }

    public toMathXML(table: NameTable): string {
        let out = ""
        function wrapIfNeeded(exp: Expression): string {
            if (exp.class == ProductType || exp.class == SumType || (
                exp.class == ExponentType && (exp as Exponent).base.class == IntegerType
            ))
                return "<mo>(</mo>" + exp.toMathXML(table) + "<mo>)</mo>"
            return exp.toMathXML(table)
        }

        // Either this is a negation, or a list of products
        // First the negation case...
        if (this.isNegation) {
            out += "<mo>-</mo>"
            out += wrapIfNeeded(this.negation)
            return out
        }

        // If it's a list of products...
        const firstFactor = this.factors[0]
        out += wrapIfNeeded(firstFactor)
        for (let i = 1; i < this.factors.length; i++) {
            let factor = this.factors[i]

            let needsDot =
                (factor.class == IntegerType &&
                    this.factors[i - 1].class == IntegerType) ||
                (factor instanceof Product && factor.isNegation) || // If there's a negative sign, get a dot
                (factor instanceof Integer && factor.value < 1)

            if (needsDot) out += "<mo>·</mo>"
            out += wrapIfNeeded(factor)
        }
        return out
    }

    /**
     * @returns Number of negative integer products.
     */
    private numNegatives(): number {
        let count = 0
        this.factors.forEach(f => {
            if (f instanceof Integer) if (f.value < 0) count++
        })
        return count
    }

    public toString(): string {
        let out = ""
        for (const exp of this.factors) {
            if (exp instanceof Product) {
                out += "(" + exp.toString() + ")"
            } else {
                out += exp.toString()
            }
            out += "·"
        }
        out = out.substring(0, out.length - 1)
        return out
    }

    public toUnambigiousString(): string {
        if (this.isNegation) return `-(${this.negation.toUnambigiousString()})`

        let out = ""
        for (const exp of this.factors) {
            if (exp instanceof Product) {
                out += "(" + exp.toString() + ")"
            } else {
                out += exp.toString()
            }
            out += "·"
        }
        out = out.substring(0, out.length - 1)
        return out
    }

    public get hash(): string {
        return "Product" + this.factors.map<string>(e => e.hash).join()
    }

    public evaluate(values: VariableValueMap): number {
        return this.factors
            .map<number>(f => f.evaluate(values))
            .reduce((a, b) => a * b)
    }

    toJSON(): string {
        if (this.factors[0].class === IntegerType && (this.factors[0] as Integer).value == -1) {
            return `["Negation",${productOrNot(...this.factors.slice(1)).toJSON()}]`
        }
        let result = '["Product"'
        for (const factor of this.factors) {
            result += ", " + factor.toJSON()
        }
        return result + "]"
    }

    // At least 2 elements, order matters
    public readonly factors: Expression[]
    public readonly class: string = ProductType
    public readonly isReducible: boolean

    public readonly isConstant: boolean
    public readonly childCount: number
}

export const ProductType = "Product"

/**
 * Can be used in array.sort() to get properly ordered products.
 *
 * @param a
 * @param b
 * @returns Positive if a should be after b
 */
export function factorOrder(a: Expression, b: Expression): number {
    if (a instanceof Integer && b instanceof Integer) return 0
    if (a instanceof Integer) {
        return aFirst
    }

    // Alphabetical
    const symbA: string | null =
        a instanceof Variable
            ? a.symbol
            : a instanceof Exponent
              ? a.base instanceof Variable
                  ? a.base.symbol
                  : null
              : null

    const symbB: string | null =
        b instanceof Variable
            ? b.symbol
            : b instanceof Exponent
              ? b.base instanceof Variable
                  ? b.base.symbol
                  : null
              : null

    if (symbA != null && symbB != null) {
        return symbA > symbB ? aFirst : aAfter
    }

    return 0
}

const aFirst = 1
const aAfter = -1
