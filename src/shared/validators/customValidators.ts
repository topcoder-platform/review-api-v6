import {
  isArray,
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

export function WeightSum(sum = 100, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'WeightSum',
      target: object.constructor,
      propertyName: propertyName,
      constraints: [sum],
      options: validationOptions,
      validator: {
        validate(value: { weight: number }[], args: ValidationArguments) {
          const [totalSum = 100] = args.constraints as [number];

          if (!isArray(value)) return false;

          const sum = value.reduce((acc, item) => {
            const weight = typeof item?.weight === 'number' ? item.weight : 0;
            return acc + weight;
          }, 0);
          return sum === totalSum;
        },

        defaultMessage(args: ValidationArguments) {
          const [totalSum = 100] = args.constraints as [number];
          return `The sum of all weights must be exactly ${totalSum}`;
        },
      },
    });
  };
}
