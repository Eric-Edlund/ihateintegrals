use std::{
    collections::{HashMap, HashSet},
    rc::Rc,
    sync::Arc,
};

use crate::{
    argument::Argument,
    convenience_expressions::i,
    derivation_rules::DerivationRule,
    expressions::{
        product::{product_of, product_of_iter},
        sum::sum_of,
        Exponent, Expression, Fraction, Negation,
    },
};

pub struct SubtractExponentsOnFractions {}

/**
* Produces one result.
* Treates the numerator and denominator as products,
* finds common factors, then removes them from the denominator,
* putting them into the numerator and adjusting their exponents.
*/
impl DerivationRule for SubtractExponentsOnFractions {
    fn apply(&self, input: Expression) -> Vec<(Expression, Rc<Argument>)> {
        let fraction = match input {
            Expression::Fraction(ref f) => f,
            _ => return vec![],
        };
        let top_factors = match fraction.numerator() {
            Expression::Product(p) => p.factors().clone(),
            _ => vec![fraction.numerator()],
        };
        let bottom_factors = match fraction.denominator() {
            Expression::Product(p) => p.factors().clone(),
            _ => vec![fraction.denominator()],
        };

        // Treat every factor of top and bottom as an exponent
        fn as_exponent(exp: &Expression) -> Arc<Exponent> {
            match exp {
                Expression::Exponent(e) => e.clone(),
                _ => match Exponent::of(exp.clone(), i(1)) {
                    Expression::Exponent(e) => e.clone(),
                    _ => panic!(),
                },
            }
        }

        let top_exponents = top_factors
            .iter()
            .map(as_exponent)
            .collect::<Vec<Arc<Exponent>>>();
        let bottom_exponents = bottom_factors
            .iter()
            .map(as_exponent)
            .collect::<Vec<Arc<Exponent>>>();

        // Find bases shared between numerator and denominator
        let common_bases = top_exponents
            .iter()
            .map(|e| e.base())
            .filter(|top_exp| {
                bottom_exponents
                    .iter()
                    .map(|e| e.base())
                    .any(|e| e == *top_exp)
            })
            .collect::<HashSet<Expression>>();

        if common_bases.is_empty() {
            return vec![];
        }

        // Store the new terms for the exponent of each base.
        let mut exponent_terms = HashMap::<Expression, Vec<Expression>>::new();
        for base in &common_bases {
            exponent_terms.insert(base.clone(), vec![]);
        }
        for exp in &top_exponents {
            if !common_bases.contains(&exp.base()) {
                continue;
            }
            exponent_terms
                .get_mut(&exp.base())
                .unwrap()
                .push(exp.power());
        }
        for exp in &bottom_exponents {
            if !common_bases.contains(&exp.base()) {
                continue;
            }
            exponent_terms
                .get_mut(&exp.base())
                .unwrap()
                .push(Negation::of(exp.power()));
        }

        let mut result_top_factors = top_exponents.into_iter().map(|exponent| {
            if common_bases.contains(&exponent.base()) {
                Exponent::of(exponent.base(), sum_of(&exponent_terms[&exponent.base()]))
            } else {
                Expression::Exponent(exponent)
            }
        });

        let result_bottom_factors = bottom_exponents
            .into_iter()
            .filter(|exponent| !common_bases.contains(&exponent.base()))
            .map(Expression::Exponent)
            .collect::<Vec<Expression>>();

        let result = Fraction::of(
            product_of_iter(&mut result_top_factors),
            product_of(&result_bottom_factors),
        );

        vec![(
            result,
            Argument::new(
                String::from("Sum exponents in both numerator and denominator"),
                vec![input],
                self.name(),
            ),
        )]
    }

    fn name(&self) -> String {
        String::from("SubtractExponentsOnFractions")
    }
}

#[cfg(test)]
mod tests {
    // use crate::convenience_expressions::v;
    //
    // use super::*;
    // use crate::derivation_rules::DerivationRule;

    #[test]
    fn test_1() {
        // let rule = SubtractExponentsOnFractions {};
        //
        // // ab / ac
        // let start = Fraction::of(product_of(&[v("a"), v("b")]), product_of(&[v("a"), v("c")]));
        // let result = rule.apply(start).first().unwrap().0.clone();
        //
        // assert_eq!(result, Fraction::of(v("b"), v("c")));
    }
}
