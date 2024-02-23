use core::fmt;
use std::sync::Arc;

use serde_json::{Value, json};

use super::{Expression, ExpressionPtr, IExpression, EXPRESSION_INSTANCES, Integer};

/**
* Stores 2 or more ordered expressions as a product.
*/
#[derive(PartialEq, Eq, Hash)]
pub struct Product {
    _factors: Vec<ExpressionPtr>,
}

impl Product {
    pub fn factors(&self) -> &Vec<ExpressionPtr> {
        &self._factors
    }

    /**
     * Creates a product from the given factors.
     * @param factors Length >= 2
     */
    pub fn of(factors: &[ExpressionPtr]) -> Result<ExpressionPtr, ()> {
        let id = {
            let mut tmp = String::from("product");
            for s in factors {
                tmp += &s.as_stringable().id();
            }
            tmp
        };

        let mut instances = EXPRESSION_INSTANCES.lock().unwrap();

        let result = instances.get(&id);
        if result.is_some() {
            return Ok(result.unwrap().clone());
        }

        let result = Product {
            _factors: factors.to_vec(),
        };
        match result.rep_ok() {
            true => {
                let pointer = Expression::Product(Arc::new(result));
                instances.insert(id, pointer.clone());
                Ok(pointer)
            }
            false => Err(()),
        }
    }

    fn rep_ok(&self) -> bool {
        self._factors.len() >= 2
    }
}

/**
* Takes 0 or more expressions, returning a product of them
* if there are more than 1, or just the 1 if there is only 1.
* If no expressions are given, returns the integer 1.
*/
pub fn product_of(factors: &[ExpressionPtr]) -> ExpressionPtr {
    if factors.is_empty() {
        return Integer::of(1);
    } else if factors.len() == 1 {
        return factors[0].clone();
    }
    Product::of(factors).unwrap()
} 

pub fn product_of_iter(factors: &mut dyn Iterator<Item = ExpressionPtr>) -> ExpressionPtr {
    let factors = factors.collect::<Vec<ExpressionPtr>>();
    if factors.len() == 1 {
        return factors[0].clone();
    }
    Product::of(&factors).unwrap()
}

impl IExpression for Product {
    fn to_unambigious_string(&self) -> String {
        let mut result = String::from("");
        result += "(";
        result += &self._factors[0].as_stringable().to_unambigious_string();
        result += " * ";

        result += &self
            ._factors
            .iter()
            .skip(1)
            .map(|f| f.as_stringable().to_unambigious_string())
            .reduce(|a, b| a + " * " + &b)
            .unwrap();

        result + ")"
    }

    fn to_math_xml(&self) -> String {
        let mut result = String::new();

        fn wrap_if_needed(exp: &ExpressionPtr) -> String {
            match exp {
                Expression::Product(e) =>
                    format!("<mo>(</mo>{}<mo>)</mo>", e.to_math_xml()),
                Expression::Sum(e) =>
                    format!("<mo>(</mo>{}<mo>)</mo>", e.to_math_xml()),
                _ => exp.as_stringable().to_math_xml()

            }
        }

        result += &wrap_if_needed(&self._factors[0]);
        for factor in self._factors.iter().skip(1) {
            result += "<mo>⋅</mo>";
            result += &wrap_if_needed(&factor);
        }
        result
    }

    fn id(&self) -> String {
        let mut suffix = String::new();
        for exp in &self._factors {
            suffix += &exp.as_stringable().id()
        }
        format!("product{}", suffix)
    }
    
    fn to_json(&self) -> Value {
        json!(
            &mut [json!("Product")].into_iter().chain(
            self._factors.iter().map(|factor| factor.to_json()))
                .collect::<Vec<Value>>()
        )
    }
}

impl fmt::Debug for Product {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let factors = self._factors.iter().map(|f| format!("{:?}", f))
            .reduce(|a, b| a + " " + &b)
            .unwrap();
        write!(f, "*({:?})", factors)
    }
}

#[cfg(test)]
mod tests {
    use crate::expressions::Integer;

    use super::*;

    #[test]
    fn factor_cardinality_invariant() {
        let legal = Product::of(&[Integer::of(0), Integer::of(1)]);
        assert!(legal.is_ok());
        let illegal = Product::of(&[Integer::of(0)]);
        assert!(!illegal.is_ok());
    }

    #[test]
    fn id_generation_preserves_children() {
        let product = Product::of(&[Integer::of(1), Integer::of(2)]).unwrap();
        let product2 = Product::of(&[Integer::of(1), Integer::of(2)]).unwrap();

        assert_eq!(
            product.as_stringable().id(),
            product2.as_stringable().id(),
            "Id not preserved"
        );
        assert_eq!(product, product2, "Flywheel not working");
    }

    #[test]
    fn to_math_xml() {
        let exp = Product::of(&[Integer::of(1), Integer::of(0)]).unwrap();
        assert_eq!(exp.as_stringable().to_math_xml(), 
            "<mn>1</mn><mn>0</mn>");
    }
}
