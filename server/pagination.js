import { _ } from 'meteor/underscore';
import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';

const countCollectionName = 'pagination-counts';

export function publishPagination(collection, settingsIn) {
  const settings = _.extend(
    {
      name: collection._name,
      filters: {},
      dynamic_filters() {
        return {};
      },
      countInterval: 10000,
    },
    settingsIn || {}
  );

  if (typeof settings.filters !== 'object') {
    // eslint-disable-next-line max-len
    throw new Meteor.Error(4001, 'Invalid filters provided. Server side filters need to be an object!');
  }

  if (typeof settings.dynamic_filters !== 'function') {
    // eslint-disable-next-line max-len
    throw new Meteor.Error(4002, 'Invalid dynamic filters provided. Server side dynamic filters needs to be a function!');
  }

  if (settings.countInterval < 50) {
    settings.countInterval = 50;
  }

  Meteor.publish(settings.name, function addPub(query = {}, optionsInput = {}) {
    check(query, Match.Optional(Object));
    check(optionsInput, Match.Optional(Object));

    const self = this;
    let options = optionsInput;
    let findQuery = {};
    let filters = [];

    if (!_.isEmpty(query)) {
      filters.push(query);
    }

    if (!_.isEmpty(settings.filters)) {
      filters.push(settings.filters);
    }

    const dynamic_filters = settings.dynamic_filters.call(self);

    if (typeof dynamic_filters === 'object') {
      if (!_.isEmpty(dynamic_filters)) {
        filters.push(dynamic_filters);
      }
    } else {
      // eslint-disable-next-line max-len
      throw new Meteor.Error(4002, 'Invalid dynamic filters return type. Server side dynamic filters needs to be a function that returns an object!');
    }

    if (typeof settings.transform_filters === 'function') {
      filters = settings.transform_filters.call(self, filters, options);
    }

    if (typeof settings.transform_options === 'function') {
      options = settings.transform_options.call(self, filters, options);
    }

    if (filters.length > 0) {
      if (filters.length > 1) {
        findQuery.$and = filters;
      } else {
        findQuery = filters[0];
      }
    }

    if (options.debug) {
      console.log(
        'Pagination',
        settings.name,
        options.reactive ? `reactive (counting every ${settings.countInterval}ms)` : 'non-reactive',
        'publish',
        JSON.stringify(findQuery),
        JSON.stringify(options)
      );
    }

    if (!options.reactive) {
      const subscriptionId = `sub_${self._subscriptionId}`;

      const count = collection.find(findQuery, options).count();
      const docs = collection.find(findQuery, options).fetch();

      _.each(docs, function(doc) {
        self.added(collection._name, doc._id, doc);
        self.changed(collection._name, doc._id, {subscriptionId: subscriptionId, count: count});
      });

    } else {
      const subscriptionId = `sub_${self._subscriptionId}`;

      const handle = collection.find(findQuery, options).observeChanges({
        added(id, fields) {
          self.added(collection._name, id, fields);
          var cursor = collection.find(findQuery, options)
          var totalItems = (cursor)? cursor.count() : 0
          //console.log("totalItems:", totalItems, subscriptionId);
          self.changed(collection._name, id, {subscriptionId: subscriptionId, totalItems: totalItems});
        },
        changed(id, fields) {
          self.changed(collection._name, id, fields);
        },
        removed(id) {
          self.removed(collection._name, id);
          var cursor = collection.find(findQuery, {sort:{totalItems: -1}})
          var sortCursor = (cursor)? cursor.fetch() : []
          var totalItems = sortCursor.length
          var firstDocId = (totalItems > 0)? sortCursor[0]._id : ""
          if (cursor.findOne({_id: firstDocId})){
            self.changed(collection._name, firstDocId, {subscriptionId: subscriptionId, totalItems: totalItems});
          } else {
            console.log("not find:", firstDocId);
          }
        }
      });

      self.onStop(() => {
        //Meteor.clearTimeout(countTimer);
        handle.stop();
      });
    }


    self.ready();
  });
}

class PaginationFactory {
  constructor(collection, settingsIn) {
    // eslint-disable-next-line max-len
    console.warn('Deprecated use of Meteor.Pagination. On server-side use publishPagination() function.');

    publishPagination(collection, settingsIn);
  }
}

Meteor.Pagination = PaginationFactory;
