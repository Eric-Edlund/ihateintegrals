use std::rc::Rc;

use crate::{argument::Argument, expressions::{product::product_of_iter, Expression, ExpressionPtr, Fraction}};

use super::DerivationRule;


/**
* (a/b) * (c/d) = ac/bd
*/
pub struct MultiplyFractions {}

impl DerivationRule for MultiplyFractions {
    fn apply(&self, input: ExpressionPtr) -> Vec<(ExpressionPtr, Rc<Argument>)> {
        let product = match input {
            Expression::Product(ref p) => p,
            _ => return vec![]
        };

        let (fractions, not): (Vec<&Expression>, Vec<&Expression>) = product
            .factors()
            .into_iter()
            .partition(|exp| matches!(exp, Expression::Fraction(_)));

        let result_fraction = Fraction::of(
            product_of_iter(&mut fractions.iter().map(|f| match f {
                Expression::Fraction(f) => f.numerator(),
                _ => panic!()
            })),
            product_of_iter(&mut fractions.iter().map(|f| match f {
                Expression::Fraction(f) => f.denominator(),
                _ => panic!()
            }))
        );

        vec![(
            product_of_iter(&mut [result_fraction].into_iter()
                .chain(&mut not.into_iter().cloned())),
            Argument::new(String::from("Multiply fractions"), vec![input])
        )]
    }
}
