'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCollection, useFirestore, useMemoFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking, useFirebaseApp, useAuth, useUser } from '@/firebase';
import { collection, doc, serverTimestamp, query, orderBy, Timestamp } from 'firebase/firestore';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { Product, Order } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Trash, Edit, Copy, Star, PlusCircle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';

const PRESET_COLORS = [
    { name: 'Black', hex: '#111827' }, { name: 'White', hex: '#FFFFFF' },
    { name: 'Stone', hex: '#A8A29E' }, { name: 'Gray', hex: '#6B7280' },
    { name: 'Red', hex: '#EF4444' }, { name: 'Pink', hex: '#EC4899' },
    { name: 'Blue', hex: '#3B82F6' }, { name: 'Sky', hex: '#0EA5E9' },
    { name: 'Green', hex: '#22C55E' }, { name: 'Lime', hex: '#84CC16' },
    { name: 'Yellow', hex: '#EAB308' }, { name: 'Orange', hex: '#F97316' },
    { name: 'Brown', hex: '#78350F' }, { name: 'Beige', hex: '#F5F5DC' },
    { name: 'Purple', hex: '#8B5CF6' }, { name: 'Indigo', hex: '#6366F1' },
    { name: 'Sage', hex: '#8F9779' }, { name: 'Olive', hex: '#556B2F' },
    { name: 'Terracotta', hex: '#E2725B' }, { name: 'Ochre', hex: '#CC7722' },
    { name: 'Sand', hex: '#C2B280' }, { name: 'Taupe', hex: '#483C32' },
    { name: 'Charcoal', hex: '#36454F' }, { name: 'Slate', hex: '#708090' },
    { name: 'Navy', hex: '#000080' }, { name: 'Maroon', hex: '#800000' },
    { name: 'Forest', hex: '#228B22' }, { name: 'Zinc', hex: '#B4B4B4' },
    { name: 'Teal', hex: '#008080' }, { name: 'Emerald', hex: '#50C878' },
    { name: 'Crimson', hex: '#DC143C' }, { name: 'Amber', hex: '#FFBF00' },
    { name: 'Violet', hex: '#8F00FF' }, { name: 'Fuchsia', hex: '#FF00FF' },
    { name: 'Mint', hex: '#98FF98' }, { name: 'Mauve', hex: '#E0B0FF' },
];

const AVAILABLE_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

const productSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z.string().min(1, 'Slug is required'),
  description: z.string().min(1, 'Description is required'),
  
  category: z.string().min(1, 'Category is required'),
  style: z.string().optional(),
  
  price: z.coerce.number().min(0, 'Price must be positive'),
  originalPrice: z.coerce.number().optional().nullable(),

  imageUrl1: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  imageUrl2: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  imageUrl3: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  imageUrl4: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  
  sizes: z.array(z.string()).optional(),
  availableColors: z.array(z.object({ name: z.string(), hex: z.string() })).optional(),
  isFeatured: z.boolean().optional(),
});

type ProductFormData = z.infer<typeof productSchema>;
type Category = { id: string; name: string };
type Style = { id: string; name: string };

function DashboardContent() {
  const { toast } = useToast();
  const firestore = useFirestore();
  const firebaseApp = useFirebaseApp();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isStyleDialogOpen, setIsStyleDialogOpen] = useState(false);
  const [newStyleName, setNewStyleName] = useState('');

  // Data fetching
  const productsQuery = useMemoFirebase(() => firestore ? collection(firestore, 'products') : null, [firestore]);
  const categoriesQuery = useMemoFirebase(() => firestore ? collection(firestore, 'categories') : null, [firestore]);
  const stylesQuery = useMemoFirebase(() => firestore ? collection(firestore, 'styles') : null, [firestore]);
  const ordersQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'orders'), orderBy('createdAt', 'desc')) : null, [firestore]);

  const { data: products, isLoading: isLoadingProducts } = useCollection<Product>(productsQuery);
  const { data: categories, isLoading: isLoadingCategories } = useCollection<Category>(categoriesQuery);
  const { data: styles, isLoading: isLoadingStyles } = useCollection<Style>(stylesQuery);
  const { data: orders, isLoading: isLoadingOrders } = useCollection<Order>(ordersQuery);

  const salesCount = useMemo(() => {
    if (!orders) return {};
    const counts: { [key: string]: number } = {};
    orders.forEach(order => {
        order.products.forEach(product => {
            counts[product.id] = (counts[product.id] || 0) + product.quantity;
        });
    });
    return counts;
  }, [orders]);

  const sortedCategories = useMemo(() => categories?.sort((a, b) => a.name.localeCompare(b.name)) || [], [categories]);
  const sortedStyles = useMemo(() => styles?.sort((a, b) => a.name.localeCompare(b.name)) || [], [styles]);

  // Seed initial data
  useEffect(() => {
    if (!firestore || isLoadingCategories || isLoadingStyles) return;

    if (categories) {
        const defaultCategories = ['Women', 'Men', 'Unisex', 'Bags'];
        const existingCategoryNames = new Set(categories.map(c => c.name.toLowerCase()));
        defaultCategories.forEach(name => {
            if (!existingCategoryNames.has(name.toLowerCase())) {
                addDocumentNonBlocking(collection(firestore, 'categories'), { name });
            }
        });
    }

    if (styles) {
        const defaultStyles = ['Casual', 'Streetwear', 'Formal', 'Vintage', 'Minimal', 'Small', 'Big', 'Luggage'];
        const existingStyleNames = new Set(styles.map(s => s.name.toLowerCase()));
        defaultStyles.forEach(name => {
            if (!existingStyleNames.has(name.toLowerCase())) {
                addDocumentNonBlocking(collection(firestore, 'styles'), { name });
            }
        });
    }
  }, [firestore, categories, styles, isLoadingCategories, isLoadingStyles]);


  const form = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: '', slug: '', description: '', category: '', style: '',
      price: 0, originalPrice: null, imageUrl1: '', imageUrl2: '',
      imageUrl3: '', imageUrl4: '', sizes: [], availableColors: [],
      isFeatured: false,
    },
  });

  const nameValue = form.watch('name');
  useEffect(() => {
    if (!editingProduct && nameValue) {
      const generatedSlug = nameValue.toLowerCase().trim().replace(/&/g, 'and').replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
      form.setValue('slug', generatedSlug, { shouldValidate: true });
    }
  }, [nameValue, editingProduct, form.setValue]);
  
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !firebaseApp) return;

    const storage = getStorage(firebaseApp);
    const storageRef = ref(storage, `products/${Date.now()}-${file.name}`);
    const uploadTask = uploadBytesResumable(storageRef, file);

    setUploading(true);
    setUploadedUrl(null);

    uploadTask.on('state_changed',
        (snapshot) => setUploadProgress((snapshot.bytesTransferred / snapshot.totalBytes) * 100),
        (error) => {
            console.error("Upload failed", error);
            setUploading(false);
        },
        () => {
            getDownloadURL(uploadTask.snapshot.ref).then((downloadURL) => {
                setUploadedUrl(downloadURL);
                setUploading(false);
                const imageFields: ('imageUrl1' | 'imageUrl2' | 'imageUrl3' | 'imageUrl4')[] = ['imageUrl1', 'imageUrl2', 'imageUrl3', 'imageUrl4'];
                const firstEmptyField = imageFields.find(field => !form.getValues(field));
                if (firstEmptyField) {
                    form.setValue(firstEmptyField, downloadURL, { shouldValidate: true });
                }
            });
        }
    );
  };

  const copyUrlToClipboard = () => {
    if (!uploadedUrl) return;
    navigator.clipboard.writeText(uploadedUrl).then(() => toast({ title: "Copied to Clipboard!" }));
  };

  useEffect(() => {
    if (editingProduct) {
      form.reset({
        name: editingProduct.name, slug: editingProduct.slug, description: editingProduct.description,
        category: editingProduct.category, style: editingProduct.style || '', price: editingProduct.price,
        originalPrice: editingProduct.originalPrice, imageUrl1: editingProduct.images?.[0]?.url || '',
        imageUrl2: editingProduct.images?.[1]?.url || '', imageUrl3: editingProduct.images?.[2]?.url || '',
        imageUrl4: editingProduct.images?.[3]?.url || '', sizes: editingProduct.sizes || [],
        availableColors: editingProduct.availableColors || [], isFeatured: editingProduct.isFeatured || false,
      });
    } else {
      form.reset();
    }
  }, [editingProduct, form]);

  const onSubmit = (data: ProductFormData) => {
    if (!firestore) return;
    
    const images = [data.imageUrl1, data.imageUrl2, data.imageUrl3, data.imageUrl4]
        .filter((url): url is string => !!url)
        .map(url => ({ url, alt: data.name, hint: 'product image' }));
    
    const productData = {
      ...data,
      style: data.style || null,
      originalPrice: data.originalPrice || null,
      images: images,
      isFeatured: data.isFeatured ?? false,
      updatedAt: serverTimestamp(),
    };

    if (editingProduct) {
      updateDocumentNonBlocking(doc(firestore, 'products', editingProduct.id), productData);
    } else {
      addDocumentNonBlocking(collection(firestore, 'products'), { ...productData, createdAt: serverTimestamp() });
    }
    
    setIsDialogOpen(false);
    setEditingProduct(null);
  };
  
  const handleDelete = (productId: string) => {
    if (!firestore) return;
    if (window.confirm('Are you sure you want to delete this product?')) {
      deleteDocumentNonBlocking(doc(firestore, 'products', productId));
    }
  }

  const openEditDialog = (product: Product) => {
    setEditingProduct(product);
    setIsDialogOpen(true);
  }
  
  const openNewDialog = () => {
    setEditingProduct(null);
    form.reset();
    setIsDialogOpen(true);
  }
  
  const handleAddCategory = () => {
    if (!firestore || !newCategoryName.trim()) return;
    addDocumentNonBlocking(collection(firestore, 'categories'), { name: newCategoryName.trim() });
    setNewCategoryName('');
    setIsCategoryDialogOpen(false);
  };
  
  const handleAddStyle = () => {
    if (!firestore || !newStyleName.trim()) return;
    addDocumentNonBlocking(collection(firestore, 'styles'), { name: newStyleName.trim() });
    setNewStyleName('');
    setIsStyleDialogOpen(false);
  };
  
  const handleUpdateOrderStatus = (orderId: string, status: Order['status']) => {
    if (!firestore) return;
    updateDocumentNonBlocking(doc(firestore, 'orders', orderId), { status });
    toast({
      title: 'Order Status Updated',
      description: `Order ${orderId.substring(0,6)}... has been set to ${status}.`
    })
  };

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <Button onClick={openNewDialog}>Add New Product</Button>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingProduct ? 'Edit Product Wizard' : 'New Product Wizard'}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 py-4">
              
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Product Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )}/>
              
              <FormField control={form.control} name="slug" render={({ field }) => (
                <FormItem><FormLabel>URL Slug</FormLabel><FormControl><Input {...field} value={field.value || ''} /></FormControl><FormMessage /></FormItem>
              )}/>

              <FormField control={form.control} name="isFeatured" render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5"><FormLabel className="text-base">Feature on Homepage</FormLabel><FormDescription>Show in "Featured Products" on the homepage.</FormDescription></div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
              )}/>

              <Separator />

              <div>
                <h3 className="text-lg font-semibold mb-4">Classification</h3>
                <div className="space-y-4">
                  <FormField control={form.control} name="category" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Page / Category</FormLabel>
                       <div className="flex gap-2">
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {isLoadingCategories && <SelectItem value="loading" disabled>Loading...</SelectItem>}
                            {sortedCategories.map(cat => <SelectItem key={cat.id} value={cat.name}>{cat.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button type="button" variant="outline" size="icon" onClick={() => setIsCategoryDialogOpen(true)}><PlusCircle className="h-4 w-4" /></Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}/>
                  <FormField control={form.control} name="style" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Style / Sub-category</FormLabel>
                      <div className="flex gap-2">
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select a style" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {isLoadingStyles && <SelectItem value="loading" disabled>Loading...</SelectItem>}
                            {sortedStyles.map(sty => <SelectItem key={sty.id} value={sty.name}>{sty.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button type="button" variant="outline" size="icon" onClick={() => setIsStyleDialogOpen(true)}><PlusCircle className="h-4 w-4" /></Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}/>
                </div>
              </div>

              <Separator />

               <div>
                <h3 className="text-lg font-semibold mb-4">Pricing</h3>
                <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="originalPrice" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Original Price (Optional)</FormLabel>
                        <FormControl><Input type="number" {...field} value={field.value ?? ''} onChange={e => field.onChange(e.target.value === '' ? null : e.target.value)} placeholder="e.g., 2000" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}/>
                    <FormField control={form.control} name="price" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Sale Price</FormLabel>
                        <FormControl><Input type="number" {...field} value={field.value ?? ''} onChange={e => field.onChange(e.target.value)} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}/>
                </div>
              </div>

               <Separator />

               <div>
                <h3 className="text-lg font-semibold mb-2">Quick Image Uploader</h3>
                <p className="text-xs text-muted-foreground mb-4">Upload an image, then copy the URL and paste it below.</p>
                <div className="space-y-4 p-4 border rounded-lg">
                    <FormItem><FormLabel>Upload Photo</FormLabel><FormControl><Input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploading} /></FormControl></FormItem>
                    {uploading && <div className="space-y-2"><Progress value={uploadProgress} /><p className="text-sm text-center">{Math.round(uploadProgress)}%</p></div>}
                    {uploadedUrl && !uploading && (
                        <div className="space-y-2"><FormLabel>Uploaded URL</FormLabel><div className="flex items-center gap-2"><Input readOnly value={uploadedUrl} /><Button type="button" variant="outline" size="icon" onClick={copyUrlToClipboard}><Copy className="h-4 w-4" /></Button></div></div>
                    )}
                </div>
              </div>

               <Separator />
              
               <div>
                <h3 className="text-lg font-semibold mb-4">Media</h3>
                 <p className="text-xs text-muted-foreground mb-4">Use external URLs for images. The first is the main one.</p>
                <div className="space-y-2">
                    <FormField control={form.control} name="imageUrl1" render={({ field }) => ( <FormItem><FormControl><Input {...field} value={field.value || ''} placeholder="Main Image URL" /></FormControl><FormMessage /></FormItem> )}/>
                    <FormField control={form.control} name="imageUrl2" render={({ field }) => ( <FormItem><FormControl><Input {...field} value={field.value || ''} placeholder="Gallery Image 2 URL" /></FormControl><FormMessage /></FormItem> )}/>
                    <FormField control={form.control} name="imageUrl3" render={({ field }) => ( <FormItem><FormControl><Input {...field} value={field.value || ''} placeholder="Gallery Image 3 URL" /></FormControl><FormMessage /></FormItem> )}/>
                    <FormField control={form.control} name="imageUrl4" render={({ field }) => ( <FormItem><FormControl><Input {...field} value={field.value || ''} placeholder="Gallery Image 4 URL" /></FormControl><FormMessage /></FormItem> )}/>
                </div>
              </div>

              <Separator />

              <div>
                 <h3 className="text-lg font-semibold mb-4">Details</h3>
                 <div className='space-y-4'>
                    <FormField control={form.control} name="description" render={({ field }) => (<FormItem><FormLabel>Description</FormLabel><FormControl><Textarea {...field} rows={5} /></FormControl><FormMessage /></FormItem>)}/>
                    <FormField control={form.control} name="sizes" render={() => (
                      <FormItem>
                          <FormLabel>Available Sizes</FormLabel>
                          <div className="flex flex-wrap gap-x-4 gap-y-2">
                          {AVAILABLE_SIZES.map((size) => (
                              <FormField key={size} control={form.control} name="sizes" render={({ field }) => (
                                <FormItem key={size} className="flex flex-row items-center space-x-2 space-y-0">
                                  <FormControl><Checkbox checked={field.value?.includes(size)} onCheckedChange={(c) => field.onChange(c ? [...(field.value || []), size] : (field.value || []).filter(v => v !== size))} /></FormControl>
                                  <FormLabel className="font-normal text-sm">{size}</FormLabel>
                                </FormItem>
                              )}/>
                          ))}
                          </div><FormMessage />
                      </FormItem>
                    )}/>
                 </div>
              </div>

               <Separator />
              
              <div>
                <h3 className="text-lg font-semibold mb-4">Color Palette</h3>
                 <FormField control={form.control} name="availableColors" render={({ field }) => (
                  <FormItem><FormControl>
                      <div className="grid grid-cols-6 sm:grid-cols-8 gap-3">
                        {PRESET_COLORS.map((color) => {
                          const isSelected = field.value?.some(c => c.hex === color.hex);
                          return <button type="button" key={color.hex} onClick={() => field.onChange(isSelected ? (field.value || []).filter(c => c.hex !== color.hex) : [...(field.value || []), color])} className={`w-9 h-9 rounded-full border-2 transition-all ${isSelected ? 'ring-2 ring-offset-2 ring-primary' : 'border-gray-300'}`} style={{ backgroundColor: color.hex }} title={color.name}><span className="sr-only">{color.name}</span></button>;
                        })}
                      </div>
                  </FormControl><FormMessage /></FormItem>
                )}/>
              </div>

              <Button type="submit" size="lg" className="w-full">{editingProduct ? 'Save Changes' : 'Finish & Add Product'}</Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      
      <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
          <DialogContent>
              <DialogHeader><DialogTitle>Add New Category</DialogTitle></DialogHeader>
              <div className="py-4"><Input placeholder="Category Name" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} /></div>
              <DialogFooter><Button onClick={handleAddCategory}>Save Category</Button></DialogFooter>
          </DialogContent>
      </Dialog>
      
      <Dialog open={isStyleDialogOpen} onOpenChange={setIsStyleDialogOpen}>
          <DialogContent>
              <DialogHeader><DialogTitle>Add New Style</DialogTitle></DialogHeader>
              <div className="py-4"><Input placeholder="Style Name" value={newStyleName} onChange={(e) => setNewStyleName(e.target.value)} /></div>
              <DialogFooter><Button onClick={handleAddStyle}>Save Style</Button></DialogFooter>
          </DialogContent>
      </Dialog>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoadingProducts && Array.from({ length: 6 }).map((_, i) => <Card key={i}><CardHeader><CardTitle><div className="h-6 bg-gray-200 rounded w-3/4 animate-pulse" /></CardTitle></CardHeader><CardContent><div className="h-4 bg-gray-200 rounded w-1/2 mb-2 animate-pulse" /><div className="h-4 bg-gray-200 rounded w-full animate-pulse" /></CardContent></Card>)}
        {products?.map(product => (
          <Card key={product.id}>
            <CardHeader>
              <CardTitle className="flex justify-between items-start">
                <span className="truncate pr-2 flex items-center gap-2">
                  {product.isFeatured && <Star className="h-4 w-4 text-yellow-400 fill-yellow-400 flex-shrink-0" />}
                  {product.name}
                </span>
                 <div className="flex gap-2 flex-shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(product)}><Edit className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(product.id)}><Trash className="h-4 w-4 text-destructive" /></Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-semibold">Ksh {product.price}</p>
              <p className="text-sm text-muted-foreground capitalize">{product.category}</p>
              <p className="text-sm mt-2 line-clamp-3">{product.description}</p>
            </CardContent>
            <CardFooter className="flex justify-end">
                <p className="text-sm font-semibold">Sales: {salesCount[product.id] || 0}</p>
            </CardFooter>
          </Card>
        ))}
      </div>

      <Separator className="my-12" />

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Recent Orders</h2>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[150px]">Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Products</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Shipping Address</TableHead>
                <TableHead className="text-right w-[140px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingOrders && (
                  <TableRow>
                      <TableCell colSpan={6} className="text-center h-24">
                          Loading orders...
                      </TableCell>
                  </TableRow>
              )}
              {orders?.map(order => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">{order.createdAt ? format((order.createdAt as Timestamp).toDate(), 'PPP') : 'N/A'}</TableCell>
                  <TableCell>
                    <div className="font-medium">{order.customerName || 'N/A'}</div>
                    <div className="text-xs text-muted-foreground">{order.customerEmail}</div>
                  </TableCell>
                  <TableCell>
                    <ul className="text-xs space-y-1">
                      {order.products.map(p => (
                        <li key={p.id}>{p.name} (x{p.quantity})</li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell>Ksh {order.totalAmount.toFixed(2)}</TableCell>
                  <TableCell className="text-xs">
                      {order.shippingAddress.description},<br/>{order.shippingAddress.region}, {order.shippingAddress.county}
                  </TableCell>
                  <TableCell className="text-right">
                    <Select
                      value={order.status}
                      onValueChange={(newStatus) => handleUpdateOrderStatus(order.id, newStatus as Order['status'])}
                    >
                      <SelectTrigger className="w-[120px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="shipped">Shipped</SelectItem>
                        <SelectItem value="delivered">Delivered</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoadingOrders && orders?.length === 0 && (
                  <TableRow>
                      <TableCell colSpan={6} className="text-center h-24">
                          No orders found.
                      </TableCell>
                  </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminDashboard() {
  const { user, isUserLoading } = useUser();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth || !ADMIN_EMAIL) {
        setLoginError("Authentication service or admin email is not configured.");
        return;
    };

    setIsLoggingIn(true);
    setLoginError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error: any) {
      if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
        setLoginError("Login failed. Please check your credentials. The admin user may need to be created in the Firebase Console first.");
      } else {
        setLoginError(`Login failed: ${error.message}`);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (isUserLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Skeleton className="h-48 w-full max-w-sm rounded-lg" />
      </div>
    );
  }

  if (user && user.email === ADMIN_EMAIL) {
    return <DashboardContent />;
  }

  if (user && user.email !== ADMIN_EMAIL) {
    return (
       <div className="container mx-auto py-8 text-center">
        <Card className="max-w-md mx-auto">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You are not authorized to view this page.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 flex justify-center items-center min-h-[60vh]">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Admin Access</CardTitle>
          <CardDescription>Enter the admin credentials to access the dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
             <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoggingIn}
              required
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoggingIn}
              required
            />
            <Button type="submit" disabled={isLoggingIn} className="w-full">
              {isLoggingIn ? 'Logging In...' : 'Login'}
            </Button>
            {loginError && <p className="text-sm font-medium text-destructive text-center">{loginError}</p>}
          </form>
          <p className="mt-4 text-xs text-center text-muted-foreground">
              Note: For first-time setup, you must create the admin user in your Firebase Console (Authentication &gt; Add user).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
