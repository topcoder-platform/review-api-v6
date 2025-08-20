import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

type ComparatorFn = (value: any, relatedValue: any) => boolean;

export function IsDependingOn(
  relatedPropertyName: string,
  comparatorFn: ComparatorFn,
  validationOptions?: ValidationOptions,
  defaultMessage?: (args: ValidationArguments) => string,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'IsDependingOn',
      target: object.constructor,
      propertyName: propertyName,
      constraints: [relatedPropertyName, comparatorFn],
      options: validationOptions,
      validator: {
        validate(value: Date, args: ValidationArguments) {
          const [relatedPropertyName, comparatorFn] = args.constraints as [
            string,
            ComparatorFn,
          ];
          const relatedValue = (args.object as any)[relatedPropertyName];

          if (typeof comparatorFn !== 'function') {
            throw new Error('Comparator function is missing in IsDependingOn');
          }

          return comparatorFn(value, relatedValue);
        },

        defaultMessage(args: ValidationArguments) {
          if (typeof defaultMessage === 'function') {
            return defaultMessage(args);
          }

          const [relatedPropertyName] = args.constraints;
          const relatedValue = (args.object as any)[relatedPropertyName];
          return `$property is invalid based on ${relatedPropertyName} (${relatedValue})`;
        },
      },
    });
  };
}

export function IsGreaterThan(
  relatedPropertyName: string,
  validationOptions?: ValidationOptions,
) {
  return IsDependingOn(
    relatedPropertyName,
    (value, related) =>
      typeof value === 'number' &&
      typeof related === 'number' &&
      value > related,
    validationOptions,
    (args: ValidationArguments) => {
      const [relatedPropertyName] = args.constraints;
      const relatedValue = (args.object as any)[relatedPropertyName];
      return `$property must be greater than ${relatedPropertyName} (${relatedValue})`;
    },
  );
}

export function IsSmallerThan(
  relatedPropertyName: string,
  validationOptions?: ValidationOptions,
) {
  return IsDependingOn(
    relatedPropertyName,
    (value, related) =>
      typeof value === 'number' &&
      typeof related === 'number' &&
      value < related,
    validationOptions,
    (args: ValidationArguments) => {
      const [relatedPropertyName] = args.constraints;
      const relatedValue = (args.object as any)[relatedPropertyName];
      return `$property must be less than ${relatedPropertyName} (${relatedValue})`;
    },
  );
}
