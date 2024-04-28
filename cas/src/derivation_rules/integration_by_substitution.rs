use std::rc::Rc;

use petgraph::visit::IntoNodeReferences;

use crate::{
    argument::Argument,
    convenience_expressions::i,
    derivation_rules::helpers::{children_rec, substitute},
    deriver::{DerivativesOnlyProfile, Deriver},
    expressions::{
        derivative::Derivative, product::product_of, substitution::Substitution, Expression,
        Fraction, Integral,
    },
    graph::Graph,
    graph_traversal::expression_complexity_cmp,
};

use super::DerivationRule;

///
/// U-substitution
///
pub struct IntegrateBySubstitution {}

impl DerivationRule for IntegrateBySubstitution {
    fn apply(&self, input: Expression) -> Vec<(Expression, Rc<Argument>)> {
        let integral = match input {
            Expression::Integral(ref i) => i,
            _ => return vec![],
        };

        let integrand = integral.integrand();

        let sub_expressions = children_rec(&integral.integrand());

        let mut substitutions = Vec::<Expression>::new();

        for u_exp in sub_expressions {
            let u_sub = Substitution::new(u_exp.clone());

            let du = match simplest_derivative(&u_exp, &integral.relative_to()) {
                Some(e) => e,
                None => {
                    println!("No derivative found");
                    continue;
                }
            };

            let sub = Substitution::new(du.clone());

            // Search the integrand for du
            let substituted = substitute(
                &substitute(&integrand, &sub, &|exp| {
                    // TODO: Could be a constant multiple... anything else?
                    *exp == du
                }),
                &u_sub,
                &|exp| *exp == u_exp,
            );

            if let Some(new_integrand) = without_factor(&substituted, &sub) {
                substitutions.push(Integral::of(new_integrand, u_sub));
            }
        }

        substitutions
            .into_iter()
            .map(|exp| {
                (
                    exp,
                    Argument::new(String::from("U-substitution"), vec![input.clone()]),
                )
            })
            .collect()
    }

    fn name(&self) -> String {
        "u-sub".into()
    }
}

/// Removes the given factor from the expression once. If the expression does
/// not contain the expression, returns none.
fn without_factor(exp: &Expression, factor: &Expression) -> Option<Expression> {
    // Pull apart fractions, products, etc.
    // Fraction denominator terms -> 1/part

    let mut factors = factors_in(exp);

    for i in 0..factors.len() {
        if &factors[i] == factor {
            factors.remove(i);
            return Some(product_of(&factors));
        }
    }

    None
}

fn factors_in(exp: &Expression) -> Vec<Expression> {
    match exp {
        Expression::Product(p) => p.factors().clone(),
        Expression::Fraction(f) => {
            let mut facts = factors_in(&f.numerator());
            facts.extend(
                factors_in(&f.denominator())
                    .into_iter()
                    .map(|exp| Fraction::of(i(1), exp)),
            );
            facts
        }
        _ => vec![exp.clone()],
    }
}

/// Evaluates the derivative, returns the simplest equivalent
/// which doesn't include derivatives of the given variable,
/// or None if the derivative couldn't be solved.
fn simplest_derivative(exp: &Expression, variable: &Expression) -> Option<Expression> {
    let mut deriver = Deriver::new(Box::new(DerivativesOnlyProfile::new()));
    let mut graph = Graph::new();
    graph.add_node(Derivative::of(exp.clone(), variable.clone()));
    deriver.expand(&mut graph, 10);

    graph
        .node_references()
        .map(|x| x.1.clone())
        .filter(|x| children_rec(x).all(|e| !matches!(e, Expression::Derivative(_))))
        .min_by(expression_complexity_cmp)
}

#[cfg(test)]
mod tests {
    use crate::{
        convenience_expressions::v,
        expressions::{product::product_of, trig_expression::TrigFn, Integral, TrigExp},
    };

    use super::*;

    #[test]
    fn test_1() {
        let rule = IntegrateBySubstitution {};

        let start = Integral::of(
            product_of(&[
                TrigExp::of(TrigFn::Sin, v("x")),
                TrigExp::of(TrigFn::Cos, v("x")),
            ]),
            v("x"),
        );
        let result = rule.apply(start).first().unwrap().0.clone();

        // We have to reuse the substitution from the result to get
        // referential equality because flywheel.
        println!("{:?}", result);
        let sub = children_rec(&result)
            .chain(vec![result.clone()])
            .find(|exp| matches!(exp, Expression::Substitution(_)))
            .unwrap();
        let typed_sub = match &sub {
            Expression::Substitution(s) => s,
            _ => unreachable!(),
        };

        assert_eq!(result, Integral::of(sub.clone(), sub.clone()));
        assert_eq!(typed_sub.exp(), TrigExp::of(TrigFn::Sin, v("x")));
    }
}