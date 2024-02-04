
use std::sync::Arc;

use super::EXPRESSION_INSTANCES;
use super::Expression;
use super::ExpressionPtr;
use super::IExpression;

#[derive(PartialEq, Eq, Hash, Debug)]
pub struct Sum {
    terms: Vec<ExpressionPtr>
}

impl Sum {
    pub fn of(terms: &[ExpressionPtr]) -> Result<ExpressionPtr, ()> {
        if terms.len() < 2 {
            return Err(());
        }

        let id = id_from_terms(terms);

        if let Ok(instances) = EXPRESSION_INSTANCES.lock() {
            let result = instances.get(&id);
            if result.is_some() {
                return Ok(result.unwrap().clone());
            }
        }

        let result = Sum {
            terms: terms.to_vec(),
        };

        let pointer = Expression::Sum(Arc::new(result));
        EXPRESSION_INSTANCES.lock().unwrap().insert(id, pointer.clone());
        Ok(pointer)
    }

    pub fn terms(&self) -> &Vec<ExpressionPtr> {
        &self.terms
    }
}

/**
* Takes one or more terms. If 2 or more, returns sum,
* otherwise, returns the given term.
*/
pub fn sum_of(terms: &[ExpressionPtr]) -> ExpressionPtr {
    if terms.len() == 1 {
        return terms[0].clone();
    }
    return Sum::of(terms).expect("Update this function to match rep invariant of sum");
}

impl IExpression for Sum {
    fn to_unambigious_string(&self) -> String {
        let mut terms_iter = self.terms.iter()
            .map(|x| x.as_stringable().to_unambigious_string());
        let mut result = terms_iter.nth(0).unwrap();
        for term in terms_iter.skip(1) {
            result += " + ";
            result += term.as_str(); 
        }

        String::from(result)
    }

    fn to_math_xml(&self) -> String {
        todo!()
    }

    fn id(&self) -> String {
        id_from_terms(&self.terms)
    }
}

fn id_from_terms(terms: &[ExpressionPtr]) -> String {
        String::from("sum") + 
        terms.iter().map(|x| x.as_stringable().id())
            .reduce(|x, y| x + y.as_str())
            .unwrap()
            .as_str()

}

#[cfg(test)]
mod tests {
    use crate::expressions::Integer;

    use super::*;

    #[test]
    fn flywheel_test() {
        assert_eq!(Sum::of(&[Integer::of(1), Integer::of(1)]), 
        Sum::of(&[Integer::of(1), Integer::of(1)]),
            "Flywheel not working");
    }

    #[test]
    fn rep_ok_enforced() {
        assert!(Sum::of(&[Integer::of(1)]).is_err()); // Because needs >= 2 terms
    }
}