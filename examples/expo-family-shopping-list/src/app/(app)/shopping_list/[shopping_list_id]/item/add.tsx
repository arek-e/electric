import { genUUID } from 'electric-sql/util';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { useElectric } from '../../../../../components/ElectricProvider';
import ShoppingListItemEditor, {
  ShoppingListItemProperties,
} from '../../../../../components/ShoppingListItemEditor';

export default function AddShoppingListItem() {
  const { shopping_list_id } = useLocalSearchParams<{ shopping_list_id?: string }>();
  if (!shopping_list_id) return <Redirect href="/" />;

  const { db } = useElectric()!;
  const onCreate = async (props: ShoppingListItemProperties) => {
    if (!props?.name) return;
    await db.shopping_list_item.create({
      data: {
        item_id: genUUID(),
        list_id: shopping_list_id,
        name: props!.name,
        quantity: props?.quantity ?? 1,
        comment: props?.comment,
        image_base_64: props?.image_base_64,
        updated_at: new Date(),
        added_at: new Date(),
        completed: false,
      },
    });

    // TODO(msfstef): should live in same transaction
    await db.shopping_list.update({
      data: { updated_at: new Date() },
      where: { list_id: shopping_list_id },
    });

    router.back();
  };

  return (
    <View>
      <ShoppingListItemEditor onSubmit={onCreate} submitText="Add item" />
    </View>
  );
}
