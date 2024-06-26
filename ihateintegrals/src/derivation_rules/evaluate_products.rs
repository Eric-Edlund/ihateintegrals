use std::rc::Rc;

use crate::{
    argument::Argument,
    convenience_expressions::i,
    expressions::{product::product_of_iter, Expression},
};

use super::DerivationRule;

pub struct EvaluateProducts {}

impl DerivationRule for EvaluateProducts {
    fn apply(&self, input: Expression) -> Vec<(Expression, Rc<Argument>)> {
        let product = match input {
            Expression::Product(ref p) => p,
            _ => return vec![],
        };

        let (ints, non_ints): (Vec<&Expression>, Vec<&Expression>) = product
            .factors()
            .iter()
            .partition(|expression| matches!(expression, Expression::Integer(_)));

        if ints.len() <= 1 {
            return vec![];
        }

        let product = ints
            .into_iter()
            .map(|i| match i {
                Expression::Integer(i) => i.value(),
                _ => panic!(),
            })
            .product();

        let result = product_of_iter(
            &mut [i(product)]
                .into_iter()
                .chain(non_ints.into_iter().cloned()),
        );

        vec![(
            result,
            Argument::new(
                String::from("Evaluate multiplication"),
                vec![input],
                self.name(),
            ),
        )]
    }
    fn name(&self) -> String {
        String::from("EvaluateProducts")
    }
}

#[cfg(test)]
mod tests {
    use super::EvaluateProducts;
    use crate::{
        convenience_expressions::{i, v},
        derivation_rules::DerivationRule,
        expressions::product::product_of,
    };

    #[test]
    fn test_1() {
        let rule = EvaluateProducts {};

        let start = product_of(&[i(1), i(2), i(2), v("a")]);
        let result = rule.apply(start).first().unwrap().0.clone();

        assert_eq!(result, product_of(&[i(4), v("a")]));
    }
}
