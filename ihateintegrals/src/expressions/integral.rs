use std::sync::Arc;

use serde_json::json;

use super::{Expression, IExpression, EXPRESSION_INSTANCES};

#[derive(PartialEq, Eq, Hash, Debug)]
pub struct Integral {
    integrand: Expression,
    variable: Expression,
}

impl Integral {
    pub fn of(integrand: Expression, variable: Expression) -> Expression {
        let id = get_id(&integrand, &variable);

        let mut instances = EXPRESSION_INSTANCES.lock().unwrap();

        if let Some(result) = instances.get(&id) {
            return result.clone();
        }

        let result = Expression::Integral(Arc::new(Integral {
            integrand,
            variable,
        }));

        instances.insert(id, result.clone());
        result
    }

    pub fn integrand(&self) -> Expression {
        self.integrand.clone()
    }

    pub fn variable(&self) -> Expression {
        self.variable.clone()
    }
}

fn get_id(integrand: &Expression, relative_to: &Expression) -> String {
    format!(
        "Integral{}{}",
        integrand.as_stringable().id(),
        relative_to.as_stringable().id()
    )
}

impl IExpression for Integral {
    fn to_unambigious_string(&self) -> String {
        format!(
            "int{}d{}",
            self.integrand.as_stringable().to_unambigious_string(),
            self.variable.as_stringable().to_unambigious_string()
        )
    }

    fn id(&self) -> String {
        get_id(&self.integrand, &self.variable)
    }

    fn to_json(&self) -> serde_json::Value {
        json!([
            "Integral",
            self.integrand.to_json(),
            self.variable.to_json()
        ])
    }
}

#[cfg(test)]
mod tests {
    use crate::expressions::Integer;

    use super::Integral;

    #[test]
    fn flywheel() {
        let a = Integral::of(Integer::of(1), Integer::of(1));
        let b = Integral::of(Integer::of(1), Integer::of(1));
        let c = Integral::of(Integer::of(2), Integer::of(1));
        assert_eq!(a, b);
        assert_ne!(a, c);
    }
}
