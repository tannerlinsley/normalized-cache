import type { Cache } from "../Cache";
import type { Entity, InvalidField, MissingField, PlainObject } from "../types";
import {
  isArrayType,
  ObjectFieldReadContext,
  resolveWrappedType,
  ValueType,
} from "../schema/types";
import { SelectionSetNode, DocumentNode } from "../language/ast";
import {
  createReference,
  isObjectWithMeta,
  isReference,
  resolveEntity,
} from "../utils/cache";
import { hasOwn } from "../utils/data";
import { getSelectionSet, getSelectionFields } from "./shared";
import { isValid, maybeGetfieldType } from "../schema/utils";

interface ReadOptions {
  id?: unknown;
  select?: DocumentNode;
}

export interface ReadResult<T = any> {
  data?: T;
  entityID?: string;
  expiresAt: number;
  invalidFields?: InvalidField[];
  invalidated: boolean;
  missingFields?: MissingField[];
  selector?: DocumentNode;
  stale: boolean;
}

interface ReadContext {
  cache: Cache;
  expiresAt: number;
  invalidFields: InvalidField[];
  invalidated: boolean;
  missingFields: MissingField[];
  /**
   * Keeps track of the results of entities which were selected without selection set.
   * This is used to build results with circular references.
   */
  fullEntityResults: Record<string, PlainObject>;
  optimistic?: boolean;
  path: (string | number)[];
  selector: DocumentNode | undefined;
}

export function executeRead<T>(
  cache: Cache,
  type: ValueType,
  optimistic: boolean,
  options: ReadOptions
): ReadResult<T> {
  const result: ReadResult = {
    expiresAt: -1,
    invalidated: false,
    selector: options.select,
    stale: true,
  };

  const entity = resolveEntity(cache, type, options.id, optimistic);

  if (!entity) {
    return result;
  }

  const ctx: ReadContext = {
    cache,
    expiresAt: -1,
    invalidFields: [],
    invalidated: false,
    missingFields: [],
    fullEntityResults: {},
    optimistic,
    selector: options.select,
    path: [],
  };

  const selectionSet = getSelectionSet(options.select, type);

  result.data = traverseEntity(ctx, entity.id, type, selectionSet);
  result.entityID = entity.id;
  result.invalidated = ctx.invalidated;
  result.expiresAt = ctx.expiresAt;

  if (ctx.missingFields.length) {
    result.missingFields = ctx.missingFields;
  }

  if (ctx.invalidFields.length) {
    result.invalidFields = ctx.invalidFields;
  }

  result.stale =
    result.invalidated ||
    (result.expiresAt !== -1 && result.expiresAt <= Date.now());

  return result;
}

function traverseEntity(
  ctx: ReadContext,
  entityID: string,
  type: ValueType | undefined,
  selectionSet: SelectionSetNode | undefined
): any {
  const entity = ctx.cache.get(entityID, ctx.optimistic);

  if (!entity) {
    addMissingField(ctx);
    return;
  }

  if (!selectionSet && ctx.fullEntityResults[entity.id]) {
    return ctx.fullEntityResults[entity.id];
  }

  checkExpiresAt(ctx, entity.expiresAt);
  checkInvalidated(ctx, entity.invalidated);

  return traverseValue(ctx, selectionSet, type, entity, entity.value);
}

function traverseValue(
  ctx: ReadContext,
  selectionSet: SelectionSetNode | undefined,
  type: ValueType | undefined,
  entity: Entity | undefined,
  data: unknown
): any {
  if (isReference(data)) {
    return traverseEntity(ctx, data.___ref, type, selectionSet);
  }

  if (type) {
    if (isValid(type, data)) {
      type = resolveWrappedType(type, data);
    } else {
      addInvalidField(ctx, data);
    }
  }

  if (isObjectWithMeta(data)) {
    const result: PlainObject = {};

    if (entity && !selectionSet) {
      ctx.fullEntityResults[entity.id] = result;
    }

    const selectionFields = getSelectionFields(
      ctx.selector,
      selectionSet,
      type,
      data
    );

    for (const fieldName of Object.keys(selectionFields)) {
      const selectionField = selectionFields[fieldName];

      ctx.path.push(fieldName);

      let fieldValue: unknown;
      let fieldValueFound = false;

      const typeField = maybeGetfieldType(type, fieldName);

      if (typeField && typeField.read) {
        const fieldReadCtx: ObjectFieldReadContext = {
          toReference: (options) => {
            const entityID = ctx.cache.identify(options);
            return entityID ? createReference(entityID) : undefined;
          },
        };
        fieldValue = typeField.read(data, fieldReadCtx);
        fieldValueFound = true;
      } else if (hasOwn(data, fieldName)) {
        fieldValue = data[fieldName];
        fieldValueFound = true;
      }

      if (fieldValueFound) {
        checkExpiresAt(ctx, data.___expiresAt[fieldName]);
        checkInvalidated(ctx, data.___invalidated[fieldName]);

        const alias = selectionField.alias
          ? selectionField.alias.value
          : fieldName;

        result[alias] = traverseValue(
          ctx,
          selectionField.selectionSet,
          typeField && typeField.type,
          undefined,
          fieldValue
        );
      } else {
        addMissingField(ctx);
      }

      ctx.path.pop();
    }

    return result;
  }

  if (Array.isArray(data)) {
    const ofType = isArrayType(type) ? type.ofType : undefined;
    const result: unknown[] = [];

    for (let i = 0; i < data.length; i++) {
      ctx.path.push(i);
      result.push(traverseValue(ctx, selectionSet, ofType, undefined, data[i]));
      ctx.path.pop();
    }

    return result;
  }

  return data;
}

function addMissingField(ctx: ReadContext) {
  ctx.missingFields.push({ path: [...ctx.path] });
}

function addInvalidField(ctx: ReadContext, value: unknown) {
  ctx.invalidFields.push({ path: [...ctx.path], value });
}

function checkInvalidated(ctx: ReadContext, invalidated: boolean) {
  if (invalidated) {
    ctx.invalidated = true;
  }
}

function checkExpiresAt(ctx: ReadContext, expiresAt: number) {
  if (expiresAt !== -1 && (ctx.expiresAt === -1 || expiresAt < ctx.expiresAt)) {
    ctx.expiresAt = expiresAt;
  }
}
